import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";
import { InvoiceList } from "@/components/invoices/InvoiceList";
import { InvoicePaper } from "@/components/invoices/InvoicePaper";
import { Kicker, PageHeader } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";
import {
  changeInvoice,
  deskProblem,
  fetchInvoices,
  type InvoiceRequest,
  type InvoicesData,
  kuwaitToday,
  requestInvoice,
  setClientFolder,
} from "@/lib/invoices";
import {
  fillInvoice,
  framed,
  type InvoiceDraft,
  loadInvoiceTemplate,
} from "@/lib/invoiceTemplate";

const message = (e: unknown) =>
  e instanceof Error ? e.message : "The database did not answer. Try again.";

/**
 * Invoices: a client success, finance, sales, admin or CEO seat makes an
 * invoice here and sees the page the client gets as it is typed (Muhammed,
 * 11 Oct 2026: "so the client success manager can generate invoices for
 * himself from the cockpit directly"). The invoice worker numbers it, files
 * it locked in the client's Drive folder and adds it to the register.
 */
export function InvoicesPage({ embedded = false }: { embedded?: boolean }) {
  const auth = useCockpitAuth();
  const [data, setData] = useState<InvoicesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const today = useMemo(() => kuwaitToday(), []);

  // Each client's tax number from their newest invoice that had one; the list is newest first.
  const taxIds = useMemo(() => {
    const out: Record<string, string> = {};
    for (const i of data?.invoices ?? []) {
      if (i.client_tax_id && !(i.clickup_task_id in out)) {
        out[i.clickup_task_id] = i.client_tax_id;
      }
    }
    return out;
  }, [data]);

  const load = useCallback(async () => {
    if (!auth.client) return;
    try {
      setData(await fetchInvoices(auth.client, auth.clients));
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, [auth.client, auth.clients]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    loadInvoiceTemplate()
      .then(setTemplate)
      .catch(() =>
        setError("The invoice template did not load. Reload the page."),
      );
  }, []);

  // While an invoice is waiting or being issued, look again every few seconds.
  const pending = data?.invoices.some(
    i => i.status === "queued" || i.status === "rendering",
  );
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [pending, load]);

  // The paper follows the form a moment after typing stops.
  useEffect(() => {
    if (!template || !draft) return;
    const timer = window.setTimeout(() => {
      try {
        setHtml(framed(fillInvoice(draft, "INV-PREVIEW", template)));
      } catch {
        // A half-typed value; the last good page stays up.
      }
    }, 100);
    return () => window.clearTimeout(timer);
  }, [template, draft]);

  const issue = useCallback(
    async (args: InvoiceRequest) => {
      if (!auth.client) return false;
      try {
        await requestInvoice(auth.client, args);
        toast.success(
          "Issuing the invoice. It shows as Issued in a minute or two.",
        );
        await load();
        return true;
      } catch (e) {
        toast.error(message(e));
        return false;
      }
    },
    [auth.client, load],
  );

  const change = useCallback(
    async (id: string, action: "cancel" | "retry") => {
      if (!auth.client) return false;
      try {
        await changeInvoice(auth.client, id, action);
        toast.success(
          action === "retry" ? "Sent back to be issued" : "Invoice cancelled",
        );
        await load();
        return true;
      } catch (e) {
        toast.error(message(e));
        return false;
      }
    },
    [auth.client, load],
  );

  const saveFolder = useCallback(
    async (taskId: string, link: string) => {
      if (!auth.client) return false;
      try {
        await setClientFolder(auth.client, taskId, link);
        toast.success("Folder saved");
        await load();
        return true;
      } catch (e) {
        toast.error(message(e));
        return false;
      }
    },
    [auth.client, load],
  );

  const deskNote = data ? deskProblem(data.desk) : null;
  return (
    <section
      className={embedded ? "space-y-6" : "mx-auto w-full max-w-6xl space-y-6"}
    >
      <PageHeader
        as={embedded ? "h2" : "h1"}
        title="Invoices"
        sub="Issue an invoice for a client. It is numbered, filed locked in the client's Drive folder and added to the invoice register."
      />

      {error ? (
        <p className="rounded-2xl border p-4 text-sm">
          <span className="txt-bad">The invoices did not load: {error}</span>{" "}
          <span className="text-muted-foreground">
            Reload the page. If it happens again, tell Muhammed.
          </span>
        </p>
      ) : null}

      {data ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start lg:gap-6">
          <InvoiceForm
            clients={data.clients}
            folders={data.folders}
            taxIds={taxIds}
            today={today}
            canSetFolder={auth.isAdmin || auth.isCeo}
            onDraft={setDraft}
            onIssue={issue}
            onSetFolder={saveFolder}
          />
          <div className="lg:sticky lg:top-4">
            <InvoicePaper
              html={html}
              caption="The client gets this page as a PDF. The invoice number is set when it is issued."
            />
          </div>
        </div>
      ) : error ? null : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-[36rem] rounded-2xl" />
          <Skeleton className="h-[36rem] rounded-2xl" />
        </div>
      )}

      {data ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Kicker>Recent invoices</Kicker>
            {deskNote ? <p className="txt-warn text-xs">{deskNote}</p> : null}
          </div>
          <InvoiceList invoices={data.invoices} onChange={change} />
        </div>
      ) : null}
    </section>
  );
}
