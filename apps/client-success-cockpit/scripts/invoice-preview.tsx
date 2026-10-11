/** Local-only visual acceptance harness for the Invoices tab. Fictional clients; nothing is issued. */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, toast } from "sonner";
import { InvoiceForm } from "../src/components/invoices/InvoiceForm";
import { InvoiceList } from "../src/components/invoices/InvoiceList";
import { InvoicePaper } from "../src/components/invoices/InvoicePaper";
import { Kicker, PageHeader } from "../src/components/kit";
import {
  fillInvoice,
  framed,
  type InvoiceDraft,
  loadInvoiceTemplate,
} from "../src/lib/invoiceTemplate";
import { type InvoiceRow, kuwaitToday } from "../src/lib/invoices";
import "../src/index.css";

const clients = [
  { taskId: "ex1", name: "Example Interior Design", country: "Saudi Arabia", plan: "Paid in full (90 days)", status: "Active", nextUsd: null, nextDate: null },
  { taskId: "ex2", name: "Example Clinic", country: "Kuwait", plan: "Monthly", status: "Active", nextUsd: 1500, nextDate: "2026-11-01" },
];
const folders = { ex1: { taskId: "ex1", folderId: "fictionalFolder123", folderName: "Mahara - Example Interior Design", matchedBy: "name" as const } };
const row = (over: Partial<InvoiceRow>): InvoiceRow => ({
  id: crypto.randomUUID(), clickup_task_id: "ex1", client_name: "Example Interior Design", kind: "paid", amount_usd: 6000,
  description: "90-day agreement", period: "Days 1-90", issue_date: "2026-10-11", due_date: null, payments: [], status: "issued",
  invoice_no: "INV-2026-025", drive_url: "https://example.com/pdf", error: null, attempts: 1, requested_by: "csm@example.com",
  requested_at: "2026-10-11T10:00:00Z", issued_at: "2026-10-11T10:01:00Z", ...over,
});
const invoices = [
  row({ status: "queued", invoice_no: null, drive_url: null, issued_at: null, kind: "checkout", client_name: "Example Clinic", amount_usd: 1500, description: "Month 2", period: null }),
  row({ status: "failed", invoice_no: null, drive_url: null, issued_at: null, error: 'No Drive folder named "Mahara - Example Clinic" was found. An admin can paste the client\'s folder link on this page, then press Try again.', client_name: "Example Clinic", kind: "autocharge", amount_usd: 1333 }),
  row({}),
];

function Preview() {
  const [template, setTemplate] = useState<string | null>(null);
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => { void loadInvoiceTemplate().then(setTemplate); }, []);
  useEffect(() => {
    if (!template || !draft) return;
    try { setHtml(framed(fillInvoice(draft, "INV-PREVIEW", template))); } catch (e) { console.warn("fill failed", e, draft); }
  }, [template, draft]);
  const fake = async () => { toast.success("Preview only. Nothing was issued."); return true; };
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4 py-10 sm:p-10">
      <p className="text-xs text-muted-foreground">Local preview · Fictional data · Nothing is issued</p>
      <section className="space-y-6">
        <PageHeader as="h2" title="Invoices" sub="Issue an invoice for a client. It is numbered, filed locked in the client's Drive folder and added to the invoice register." />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
          <InvoiceForm clients={clients} folders={folders} today={kuwaitToday()} canSetFolder onDraft={setDraft} onIssue={fake} onSetFolder={fake} />
          <div className="lg:sticky lg:top-4">
            <InvoicePaper html={html} caption="The client gets this page as a PDF. The invoice number is set when it is issued." />
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Kicker>Issued from the cockpit</Kicker>
            <p className="txt-warn text-xs">The invoice worker has not started yet. Invoices you ask for wait in the list until it does. Tell Muhammed.</p>
          </div>
          <InvoiceList invoices={invoices} onChange={fake} />
        </div>
      </section>
      <Toaster />
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);
