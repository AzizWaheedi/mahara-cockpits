import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";
import { InvoiceList } from "@/components/invoices/InvoiceList";
import { InvoicePaper } from "@/components/invoices/InvoicePaper";
import { Kicker, PageHeader } from "@/components/kit";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import {
  aLink,
  changeInvoice,
  deskProblem,
  fetchDeskStatus,
  fetchInvoices,
  type InvoiceAction,
  type InvoicePrefill,
  type InvoiceRequest,
  type InvoiceRow,
  type InvoicesData,
  isMadeLink,
  kuwaitToday,
  LINK_NAME,
  type MadeLink,
  requestInvoice,
  sameWith,
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
 * himself from the cockpit directly"). The invoice worker numbers it, makes
 * the Ecom or Whop link a Pay online invoice asks for, files it locked in the
 * client's Drive folder and adds it to the register.
 */
export function InvoicesPage({ embedded = false }: { embedded?: boolean }) {
  const auth = useCockpitAuth();
  const [data, setData] = useState<InvoicesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  // "Same invoice with Whop": the form opens again on these, once per press.
  const [prefill, setPrefill] = useState<{
    nonce: number;
    values: InvoicePrefill;
  } | null>(null);
  const formTop = useRef<HTMLDivElement>(null);
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

  // Each client's email from their newest invoice that had one (Tap links need it).
  const emails = useMemo(() => {
    const out: Record<string, string> = {};
    for (const i of data?.invoices ?? []) {
      if (i.client_email && !(i.clickup_task_id in out)) {
        out[i.clickup_task_id] = i.client_email;
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

  // The worker's check-in ages while the page stays open: read it again every
  // minute and when the tab comes back, so a long form does not show a false
  // "last checked in N minutes ago". A failed read keeps the last reading.
  useEffect(() => {
    if (!auth.client) return;
    const client = auth.client;
    const refresh = () => {
      if (document.hidden) return;
      fetchDeskStatus(client)
        .then(desk => setData(d => (d ? { ...d, desk } : d)))
        .catch(() => {});
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [auth.client]);

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
    async (id: string, action: InvoiceAction, email?: string) => {
      if (!auth.client) return false;
      try {
        await changeInvoice(auth.client, id, action, email);
        toast.success(
          action === "retry"
            ? "Sent back to be issued"
            : isMadeLink(action)
              ? `Sent back to be issued with ${aLink(action)}`
              : "Invoice cancelled",
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

  /** The same invoice again with another link, in the form, for the CSM to check and issue. */
  const againWith = useCallback(
    (inv: InvoiceRow, mode: MadeLink) => {
      setPrefill(prev => ({
        nonce: (prev?.nonce ?? 0) + 1,
        values: {
          ...sameWith(inv, today, mode),
          // The client's email from any earlier invoice, for Tap.
          clientEmail: inv.client_email ?? emails[inv.clickup_task_id] ?? "",
        },
      }));
      formTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      const old = isMadeLink(inv.checkout_source)
        ? LINK_NAME[inv.checkout_source]
        : "old";
      toast.success(
        `The form has the same invoice with ${aLink(mode)}. Check it${mode === "tap" ? " and the client's email" : ""} and issue it, then send the client the new link. The old ${old} link stays payable until it expires.`,
        // Long enough to read on a phone.
        { duration: 10_000 },
      );
    },
    [today, emails],
  );

  const deskNote = data ? deskProblem(data.desk) : null;
  return (
    <section
      className={embedded ? "space-y-6" : "mx-auto w-full max-w-6xl space-y-6"}
    >
      <PageHeader
        as={embedded ? "h2" : "h1"}
        title="Invoices"
        sub="Issue an invoice for a client. It is numbered, filed locked in the client's Drive folder and added to the invoice register. Pay online invoices get an Ecom link, or a Whop or Tap link as a backup."
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
          <div ref={formTop} className="min-w-0 scroll-mt-20 lg:scroll-mt-4">
            <InvoiceForm
              key={prefill?.nonce ?? 0}
              clients={data.clients}
              folders={data.folders}
              taxIds={taxIds}
              emails={emails}
              today={today}
              canSetFolder={auth.isAdmin || auth.isCeo}
              prefill={prefill?.values}
              onDraft={setDraft}
              onIssue={issue}
              onSetFolder={saveFolder}
            />
          </div>
          <div className="lg:sticky lg:top-4">
            <InvoicePaper
              html={html}
              caption="The client gets this page as a PDF. The invoice number is set when it is issued."
            />
          </div>
        </div>
      ) : error ? null : (
        <LoadingSkeleton
          variant="cards"
          rows={2}
          label="Reading the invoices"
        />
      )}

      {data ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Kicker>Recent invoices</Kicker>
            {deskNote ? <p className="txt-warn text-xs">{deskNote}</p> : null}
          </div>
          {data.paid === null ? (
            <p className="text-xs text-muted-foreground">
              Whether the Ecom and Tap links were paid did not load. Reload the
              page to see it.
            </p>
          ) : null}
          <InvoiceList
            invoices={data.invoices}
            paid={data.paid}
            onChange={change}
            onRedo={againWith}
          />
        </div>
      ) : null}
    </section>
  );
}
