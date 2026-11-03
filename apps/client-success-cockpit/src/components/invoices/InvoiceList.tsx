import { Copy, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Chip, ExtLink, type Tone } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { shortDay } from "@/lib/format";
import {
  canRedoWithWhop,
  canSwitchToWhop,
  type InvoiceRow,
  type InvoiceStatus,
  type PaymentState,
  paymentWord,
  whopCopyOf,
} from "@/lib/invoices";
import { money } from "@/lib/invoiceTemplate";
import { KINDS } from "./InvoiceForm";

const STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  queued: { label: "Waiting", tone: "neutral" },
  rendering: { label: "Issuing", tone: "accent" },
  issued: { label: "Issued", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const SOURCE_WORD: Record<InvoiceRow["checkout_source"], string> = {
  ecom: "Ecom link",
  whop: "Whop link",
  pasted: "Pasted link",
};

const PAGE_WORD: Record<InvoiceRow["checkout_source"], string> = {
  ecom: "Ecom payment page",
  whop: "Whop payment page",
  pasted: "Payment page",
};

type Action = "cancel" | "retry" | "whop";

/** Every invoice asked for from the cockpit, newest first, with what to do next. */
export function InvoiceList({
  invoices,
  paid = {},
  onChange,
  onWhop,
}: {
  invoices: InvoiceRow[];
  /** Ecom's word per issued Ecom invoice; null when it did not load. */
  paid?: Record<string, PaymentState> | null;
  onChange: (id: string, action: Action) => Promise<boolean>;
  /** "Same invoice with Whop": the page refills the form from this invoice. */
  onWhop?: (inv: InvoiceRow) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: Action) {
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
        // Without Ecom's answer an Ecom row says nothing, never "Not paid yet".
        const unknown = paid === null && inv.checkout_source === "ecom";
        const state = paid?.[inv.id];
        const pay = unknown ? null : paymentWord(inv, state);
        const redo = onWhop && !unknown && canRedoWithWhop(inv, state);
        const copied = redo ? whopCopyOf(inv, invoices) : null;
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
                {kind}
                {inv.kind === "checkout"
                  ? ` · ${SOURCE_WORD[inv.checkout_source]}`
                  : ""}{" "}
                · {inv.description}
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
              <div className="flex flex-wrap gap-1.5 sm:justify-end">
                <Chip tone={status.tone}>{status.label}</Chip>
                {pay ? (
                  <Chip
                    tone={pay.tone}
                    title={
                      state?.paid_at
                        ? `Paid ${shortDay(state.paid_at)}${state.method ? ` by ${state.method}` : ""}`
                        : undefined
                    }
                  >
                    {pay.text}
                  </Chip>
                ) : null}
              </div>
            </div>
            {inv.status === "issued" ? (
              <div className="flex w-full flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs">
                {inv.drive_url ? (
                  <>
                    <ExtLink href={inv.drive_url}>Open PDF</ExtLink>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copy(inv.drive_url ?? "", "PDF link")}
                    >
                      <Copy />
                      Copy PDF link
                    </Button>
                  </>
                ) : null}
                {inv.kind === "checkout" && inv.checkout_url ? (
                  <>
                    <ExtLink href={inv.checkout_url}>
                      {PAGE_WORD[inv.checkout_source]}
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
                {copied ? (
                  <span
                    className="text-muted-foreground"
                    title={`The same invoice with a Whop link is ${copied.invoice_no ?? "in this list, waiting for its number"}. Send the client that link. The Ecom link stays payable until it expires.`}
                  >
                    Whop copy made
                  </span>
                ) : redo ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Ecom does not work for this client? Make the same invoice with a Whop link, then send the client the new link. The Ecom link stays payable until it expires."
                    onClick={() => onWhop?.(inv)}
                  >
                    Same invoice with Whop
                  </Button>
                ) : null}
              </div>
            ) : null}
            {inv.status === "failed" || inv.status === "queued" ? (
              <div className="flex w-full flex-wrap items-center justify-end gap-2">
                {canSwitchToWhop(inv) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => act(inv.id, "whop")}
                  >
                    {busy === `${inv.id}:whop` ? (
                      <Loader2 className="animate-spin" />
                    ) : null}
                    Use a Whop link instead
                  </Button>
                ) : null}
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
