import { Copy, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Chip, ExtLink, type Tone } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { shortDay } from "@/lib/format";
import type { InvoiceRow, InvoiceStatus } from "@/lib/invoices";
import { money } from "@/lib/invoiceTemplate";
import { KINDS } from "./InvoiceForm";

const STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  queued: { label: "Waiting", tone: "neutral" },
  rendering: { label: "Issuing", tone: "accent" },
  issued: { label: "Issued", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** Every invoice asked for from the cockpit, newest first, with what to do next. */
export function InvoiceList({
  invoices,
  onChange,
}: {
  invoices: InvoiceRow[];
  onChange: (id: string, action: "cancel" | "retry") => Promise<boolean>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: "cancel" | "retry") {
    setBusy(`${id}:${action}`);
    await onChange(id, action);
    setBusy(null);
  }

  async function copy(url: string, what: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`${what} copied`);
    } catch {
      toast.error(
        `The ${what.toLowerCase()} was not copied. Open it and copy it from the address bar.`,
      );
    }
  }

  if (!invoices.length) {
    return (
      <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
        No invoices yet. Pick a client above and issue the first one.
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-2xl border bg-card">
      {invoices.map(inv => {
        const status = STATUS[inv.status];
        const kind = KINDS.find(k => k.key === inv.kind)?.label ?? inv.kind;
        return (
          <li
            key={inv.id}
            className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3 sm:px-6"
          >
            <div className="w-28 shrink-0 pt-0.5 font-mono text-xs tabular-nums">
              {inv.invoice_no ?? (
                <span className="text-muted-foreground">No number yet</span>
              )}
            </div>
            <div className="min-w-0 flex-1 basis-56">
              <div className="truncate text-sm font-medium">
                {inv.client_name}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {kind} · {inv.description}
                {inv.period ? ` · ${inv.period}` : ""}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Asked for by {inv.requested_by} on {shortDay(inv.requested_at)}
                {inv.issued_at ? `, issued ${shortDay(inv.issued_at)}` : ""}
              </div>
              {inv.status === "failed" && inv.error ? (
                <p className="txt-bad mt-1.5 text-xs">{inv.error}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
              <div className="font-mono text-sm tabular-nums">
                USD {money(inv.amount_usd)}
              </div>
              <Chip tone={status.tone}>{status.label}</Chip>
            </div>
            {inv.status === "issued" && inv.drive_url ? (
              <div className="flex w-full flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs">
                <ExtLink href={inv.drive_url}>Open PDF</ExtLink>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copy(inv.drive_url ?? "", "PDF link")}
                >
                  <Copy />
                  Copy PDF link
                </Button>
                {inv.kind === "checkout" && inv.checkout_url ? (
                  <>
                    <ExtLink href={inv.checkout_url}>
                      {inv.checkout_source === "ecom" ? "Ecom payment page" : inv.whop_plan_id ? "Whop payment page" : "Payment page"}
                    </ExtLink>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        copy(inv.checkout_url ?? "", "Payment link")
                      }
                    >
                      <Copy />
                      Copy payment link
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null}
            {inv.status === "failed" || inv.status === "queued" ? (
              <div className="flex w-full items-center justify-end gap-2">
                {inv.status === "failed" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => act(inv.id, "retry")}
                  >
                    {busy === `${inv.id}:retry` ? (
                      <Loader2 className="animate-spin" />
                    ) : null}
                    Try again
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => act(inv.id, "cancel")}
                >
                  {busy === `${inv.id}:cancel` ? (
                    <Loader2 className="animate-spin" />
                  ) : null}
                  Cancel
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
