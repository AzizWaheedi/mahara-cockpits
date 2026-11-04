/**
 * Local-only visual acceptance harness for the Invoices tab. Fictional
 * clients; nothing is issued. The list has a row for every Whop path: a
 * failed Ecom invoice that can switch, an issued Whop one, and issued Ecom
 * ones unpaid, paid, and unpaid with its Whop copy already made.
 */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, toast } from "sonner";
import { InvoiceForm } from "../src/components/invoices/InvoiceForm";
import { InvoiceList } from "../src/components/invoices/InvoiceList";
import { InvoicePaper } from "../src/components/invoices/InvoicePaper";
import { Kicker, PageHeader } from "../src/components/kit";
import {
  type InvoicePrefill,
  type InvoiceRow,
  kuwaitToday,
  type PaymentState,
  sameWithWhop,
} from "../src/lib/invoices";
import {
  fillInvoice,
  framed,
  type InvoiceDraft,
  loadInvoiceTemplate,
} from "../src/lib/invoiceTemplate";
import "../src/index.css";

const clients = [
  {
    taskId: "ex1",
    name: "Example Interior Design",
    country: "Saudi Arabia",
    plan: "Paid in full (90 days)",
    status: "Active",
    nextUsd: null,
    nextDate: null,
  },
  {
    taskId: "ex2",
    name: "Example Clinic",
    country: "Kuwait",
    plan: "Monthly",
    status: "Active",
    nextUsd: 1500,
    nextDate: "2026-11-01",
  },
];
const folders = {
  ex1: {
    taskId: "ex1",
    folderId: "fictionalFolder123",
    folderName: "Mahara - Example Interior Design",
    matchedBy: "name" as const,
  },
};
const row = (over: Partial<InvoiceRow>): InvoiceRow => ({
  id: crypto.randomUUID(),
  clickup_task_id: "ex1",
  client_name: "Example Interior Design",
  kind: "paid",
  amount_usd: 6000,
  description: "90-day agreement",
  line_note: null,
  client_detail: "Saudi Arabia",
  client_tax_id: null,
  period: "Days 1-90",
  pay_note: null,
  issue_date: "2026-10-11",
  due_date: null,
  payments: [],
  checkout_source: "pasted",
  checkout_url: null,
  whop_plan_id: null,
  ecom_invoice_id: null,
  amount_kwd: null,
  kwd_rate: null,
  status: "issued",
  invoice_no: "INV-2026-025",
  drive_url: "https://example.com/pdf",
  error: null,
  attempts: 1,
  requested_by: "csm@example.com",
  requested_at: "2026-10-11T10:00:00Z",
  issued_at: "2026-10-11T10:01:00Z",
  ...over,
});
const invoices = [
  row({
    status: "queued",
    invoice_no: null,
    drive_url: null,
    issued_at: null,
    kind: "checkout",
    checkout_source: "ecom",
    client_name: "Example Clinic",
    amount_usd: 1500,
    description: "Month 2",
    period: null,
  }),
  row({
    status: "failed",
    invoice_no: null,
    drive_url: null,
    issued_at: null,
    error:
      'No Drive folder named "Mahara - Example Clinic" was found. An admin can paste the client\'s folder link on this page, then press Try again.',
    client_name: "Example Clinic",
    kind: "autocharge",
    amount_usd: 1333,
  }),
  row({
    status: "failed",
    invoice_no: null,
    drive_url: null,
    issued_at: null,
    kind: "checkout",
    client_name: "Example Clinic",
    clickup_task_id: "ex2",
    client_detail: "Kuwait",
    amount_usd: 1500,
    description: "Month 2",
    period: null,
    due_date: "2026-11-20",
    checkout_source: "ecom",
    error:
      "Ecom refused the link (HTTP 422: merchant is not active). Tell Muhammed.",
  }),
  row({
    id: "ex-whop",
    kind: "checkout",
    invoice_no: "INV-2026-032",
    client_name: "Example Clinic",
    clickup_task_id: "ex2",
    client_detail: "Kuwait",
    amount_usd: 1500,
    description: "Month 2",
    period: null,
    due_date: "2026-11-20",
    checkout_source: "whop",
    whop_plan_id: "plan_Example123",
    checkout_url: "https://whop.com/checkout/plan_Example123",
    requested_at: "2026-11-01T09:00:00Z",
    issued_at: "2026-11-01T09:02:00Z",
  }),
  row({
    id: "ex-ecom-unpaid",
    kind: "checkout",
    invoice_no: "INV-2026-030",
    amount_usd: 2000,
    description: "Deposit",
    period: null,
    due_date: "2026-11-10",
    checkout_source: "ecom",
    ecom_invoice_id: "INV_Example12345",
    checkout_url: "https://invoice.ecom.io/example",
    amount_kwd: 614,
    kwd_rate: 0.307,
    requested_at: "2026-10-30T09:00:00Z",
    issued_at: "2026-10-30T09:02:00Z",
  }),
  // The Ecom invoice the Whop row above is a copy of: no second copy offered.
  row({
    id: "ex-ecom-copied",
    kind: "checkout",
    invoice_no: "INV-2026-031",
    client_name: "Example Clinic",
    clickup_task_id: "ex2",
    client_detail: "Kuwait",
    amount_usd: 1500,
    description: "Month 2",
    period: null,
    due_date: "2026-11-20",
    checkout_source: "ecom",
    ecom_invoice_id: "INV_Example24680",
    checkout_url: "https://invoice.ecom.io/example-copied",
    amount_kwd: 460.5,
    kwd_rate: 0.307,
    requested_at: "2026-10-31T09:00:00Z",
    issued_at: "2026-10-31T09:02:00Z",
  }),
  row({
    id: "ex-ecom-paid",
    kind: "checkout",
    invoice_no: "INV-2026-029",
    amount_usd: 1000,
    description: "Deposit",
    period: null,
    due_date: "2026-10-25",
    checkout_source: "ecom",
    ecom_invoice_id: "INV_Example67890",
    checkout_url: "https://invoice.ecom.io/example-paid",
    amount_kwd: 307,
    kwd_rate: 0.307,
    requested_at: "2026-10-20T09:00:00Z",
    issued_at: "2026-10-20T09:02:00Z",
  }),
  row({ client_tax_id: "300123456700003" }),
];
// What cockpit_invoice_payments would say about the issued Ecom rows.
const paid: Record<string, PaymentState> = {
  "ex-ecom-unpaid": { status: "UNPAID", paid_at: null, method: null },
  "ex-ecom-copied": { status: "UNPAID", paid_at: null, method: null },
  "ex-ecom-paid": {
    status: "PAID",
    paid_at: "2026-10-21T08:00:00Z",
    method: "KNET",
  },
};
// What the page works out from the list: the newest tax number per client.
const taxIds = { ex1: "300123456700003" };

function Preview() {
  const [template, setTemplate] = useState<string | null>(null);
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{
    nonce: number;
    values: InvoicePrefill;
  } | null>(null);
  const formTop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void loadInvoiceTemplate().then(setTemplate);
  }, []);
  useEffect(() => {
    if (!template || !draft) return;
    try {
      setHtml(framed(fillInvoice(draft, "INV-PREVIEW", template)));
    } catch (e) {
      console.warn("fill failed", e, draft);
    }
  }, [template, draft]);
  const fake = async () => {
    toast.success("Preview only. Nothing was issued.");
    return true;
  };
  const whop = (inv: InvoiceRow) => {
    setPrefill(prev => ({
      nonce: (prev?.nonce ?? 0) + 1,
      values: sameWithWhop(inv, kuwaitToday()),
    }));
    formTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    toast.success(
      "The form has the same invoice with a Whop link. Check it and issue it, then send the client the new link. The old Ecom link stays payable until it expires.",
      // Long enough to read on a phone.
      { duration: 10_000 },
    );
  };
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4 py-10 sm:p-10">
      <p className="text-xs text-muted-foreground">
        Local preview · Fictional data · Nothing is issued
      </p>
      <section className="space-y-6">
        <PageHeader
          as="h2"
          title="Invoices"
          sub="Issue an invoice for a client. It is numbered, filed locked in the client's Drive folder and added to the invoice register. Pay online invoices get an Ecom or Whop link."
        />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start lg:gap-6">
          <div ref={formTop} className="min-w-0 scroll-mt-4">
            <InvoiceForm
              key={prefill?.nonce ?? 0}
              clients={clients}
              folders={folders}
              taxIds={taxIds}
              today={kuwaitToday()}
              canSetFolder
              prefill={prefill?.values}
              onDraft={setDraft}
              onIssue={fake}
              onSetFolder={fake}
            />
          </div>
          <div className="lg:sticky lg:top-4">
            <InvoicePaper
              html={html}
              caption="The client gets this page as a PDF. The invoice number is set when it is issued."
            />
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Kicker>Recent invoices</Kicker>
            <p className="txt-warn text-xs">
              The invoice worker has not started yet. Invoices you ask for wait
              in the list until it does. Tell Muhammed.
            </p>
          </div>
          <InvoiceList
            invoices={invoices}
            paid={paid}
            onChange={fake}
            onWhop={whop}
          />
        </div>
      </section>
      <Toaster />
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);
