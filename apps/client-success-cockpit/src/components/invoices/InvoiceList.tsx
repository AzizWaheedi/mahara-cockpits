import { Copy, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Chip, ExtLink, type Tone } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shortDay } from "@/lib/format";
import {
  aLink,
  copyOf,
  emailOk,
  type InvoiceAction,
  type InvoiceRow,
  type InvoiceStatus,
  isMadeLink,
  LINK_NAME,
  type MadeLink,
  type PaymentState,
  paymentWord,
  redoTargets,
  switchTargets,
  watched,
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
  tap: "Tap link",
  pasted: "Pasted link",
};

const PAGE_WORD: Record<InvoiceRow["checkout_source"], string> = {
  ecom: "Ecom payment page",
  whop: "Whop payment page",
  tap: "Tap payment page",
  pasted: "Payment page",
};

/** The switch button's words: "Use a Whop link instead". */
const USE_INSTEAD = (m: MadeLink) => `Use ${aLink(m)} instead`;

/** Every invoice asked for from the cockpit, newest first, with what to do next. */
export function InvoiceList({
  invoices,
  paid = {},
  onChange,
  onRedo,
}: {
  invoices: InvoiceRow[];
  /** Ecom's or Tap's word per issued invoice; null when it did not load. */
  paid?: Record<string, PaymentState> | null;
  onChange: (
    id: string,
    action: InvoiceAction,
    email?: string,
  ) => Promise<boolean>;
  /** "Same invoice with Whop" (or Tap, or Ecom): the page refills the form from this invoice. */
  onRedo?: (inv: InvoiceRow, mode: MadeLink) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  /** The failed invoice whose switch to Tap is waiting for the client's email. */
  const [askEmail, setAskEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");

  async function act(id: string, action: InvoiceAction, withEmail?: string) {
    setBusy(`${id}:${action}`);
    const ok = await onChange(id, action, withEmail);
    setBusy(null);
    if (ok) setAskEmail(null);
  }

  function switchTo(inv: InvoiceRow, m: MadeLink) {
    if (m === "tap" && !inv.client_email) {
      setEmail("");
      setAskEmail(inv.id);
      return;
    }
    void act(inv.id, m);
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
        // Without Ecom's or Tap's answer their rows say nothing, never "Not paid yet".
        const unknown = paid === null && watched(inv);
        const state = paid?.[inv.id];
        const pay = unknown ? null : paymentWord(inv, state);
        const redo =
          onRedo && !unknown ? redoTargets(inv, state, invoices) : [];
        // The note stays even when every backup was already tried.
        const copied =
          onRedo && !unknown && watched(inv) && pay?.text !== "Paid"
            ? copyOf(inv, invoices)
            : null;
        const from = isMadeLink(inv.checkout_source)
          ? LINK_NAME[inv.checkout_source]
          : "old";
        const switches = switchTargets(inv, invoices);
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
                {copied && isMadeLink(copied.checkout_source) ? (
                  <span
                    className="text-muted-foreground"
                    title={`The same invoice with ${aLink(copied.checkout_source)} is ${copied.invoice_no ?? "in this list, waiting for its number"}. Send the client that link. The ${from} link stays payable until it expires.`}
                  >
                    {LINK_NAME[copied.checkout_source]} copy made
                  </span>
                ) : (
                  redo.map(m => (
                    <Button
                      key={m}
                      variant="ghost"
                      size="sm"
                      title={`${from} does not work for this client? Make the same invoice with ${aLink(m)}, then send the client the new link. The ${from} link stays payable until it expires.`}
                      onClick={() => onRedo?.(inv, m)}
                    >
                      Same invoice with {LINK_NAME[m]}
                    </Button>
                  ))
                )}
              </div>
            ) : null}
            {inv.status === "failed" || inv.status === "queued" ? (
              <div className="flex w-full flex-wrap items-center justify-end gap-2">
                {askEmail === inv.id ? (
                  <form
                    className="flex w-full flex-wrap items-center justify-end gap-2"
                    onSubmit={e => {
                      e.preventDefault();
                      if (emailOk(email)) void act(inv.id, "tap", email);
                    }}
                  >
                    <label
                      htmlFor={`tap-email-${inv.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      Tap needs the client's email
                    </label>
                    <Input
                      id={`tap-email-${inv.id}`}
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      maxLength={254}
                      placeholder="name@company.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="h-8 w-56 max-w-full"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={busy !== null || !emailOk(email)}
                    >
                      {busy === `${inv.id}:tap` ? (
                        <Loader2 className="animate-spin" />
                      ) : null}
                      Use the Tap link
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() => setAskEmail(null)}
                    >
                      Back
                    </Button>
                  </form>
                ) : (
                  switches.map(m => (
                    <Button
                      key={m}
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => switchTo(inv, m)}
                    >
                      {busy === `${inv.id}:${m}` ? (
                        <Loader2 className="animate-spin" />
                      ) : null}
                      {USE_INSTEAD(m)}
                    </Button>
                  ))
                )}
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
