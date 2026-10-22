import { Loader2, Plus, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Dot, ExtLink, Kicker, Pill, PillRow } from "@/components/kit";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type ClientFolder,
  cents,
  type InvoiceClient,
  type InvoiceRequest,
} from "@/lib/invoices";
import {
  type InvoiceDraft,
  type InvoiceKind,
  money,
} from "@/lib/invoiceTemplate";

/**
 * The invoice form. It asks only for what the template prints; the database
 * checks it all again (cockpit_invoice_request) and its sentences are the
 * ones shown when it refuses. Every change goes up as a draft for the preview.
 */

export const KINDS: { key: InvoiceKind; label: string; hint: string }[] = [
  {
    key: "paid",
    label: "Paid",
    hint: "Proof of money already received, with each payment listed.",
  },
  {
    key: "checkout",
    label: "Pay online",
    hint: "The client pays by a payment link before the due date.",
  },
  {
    key: "autocharge",
    label: "Card on file",
    hint: "The card on file is charged on the due date. Nothing for the client to do.",
  },
];

const METHODS = ["Bank transfer", "Card", "Whop", "Cash"];
const MAX_PAYMENTS = 12;

type PayLine = {
  key: number;
  date: string;
  method: string;
  amount: string;
  ref: string;
};

type State = {
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
  /** "Pay online": the worker creates the Whop link, or a person pastes one. */
  linkMode: "whop" | "paste";
  checkoutUrl: string;
  payments: PayLine[];
};

/** What the preview's Pay now button points at until the worker makes the real link. */
const WHOP_PREVIEW = "https://whop.com/checkout/";

let nextKey = 1;
const blankPayment = (today: string): PayLine => ({
  key: nextKey++,
  date: today,
  method: "Bank transfer",
  amount: "",
  ref: "",
});

/** The same rule the database checks (cockpit_invoices_client_tax_id_check). */
const TAX_ID = /^[A-Za-z0-9][A-Za-z0-9 ./-]{0,39}$/;

const fresh = (
  today: string,
  taskId = "",
  clientDetail = "",
  taxId = "",
): State => ({
  taskId,
  kind: "paid",
  amount: "",
  description: "",
  lineNote: "",
  clientDetail,
  taxId,
  period: "",
  payNote: "",
  dueDate: "",
  linkMode: "whop",
  checkoutUrl: "",
  payments: [blankPayment(today)],
});

const field =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm";

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const usd = (c: number) => `USD ${money((c / 100).toFixed(2))}`;

/** The first thing still missing, in the database's own words; null when ready. */
function problemOf(s: State, today: string): string | null {
  if (!s.taskId) return "Pick a client.";
  if (s.taxId.trim() && !TAX_ID.test(s.taxId.trim()))
    return "Type the tax number with letters, numbers, spaces, dots or dashes only.";
  const total = cents(s.amount);
  if (total === null)
    return "Type the amount in US dollars, for example 1500 or 1500.50.";
  if (total <= 0) return "The amount must be more than 0.";
  if (!s.description.trim())
    return 'Type a description, for example "90-day agreement".';
  if (
    s.kind === "checkout" &&
    s.linkMode === "paste" &&
    !/^https:\/\/[^\s<>"']+$/.test(s.checkoutUrl.trim())
  ) {
    return "Paste the full payment link, starting with https://.";
  }
  if (s.kind !== "paid" && !s.dueDate)
    return "Pick the date the payment is due.";
  if (s.kind === "paid") {
    let sum = 0;
    for (const p of s.payments) {
      if (!p.date || p.date > today)
        return "Each payment needs the day it arrived, today or before.";
      if (!p.method.trim())
        return 'Each payment needs a method, for example "Bank transfer".';
      const c = cents(p.amount);
      if (c === null || c <= 0)
        return "Each payment needs an amount in US dollars, more than 0.";
      sum += c;
    }
    if (sum !== total) {
      return `The payments add up to ${usd(sum)}, but the invoice total is ${usd(total)}. Make them match.`;
    }
  }
  return null;
}

export function InvoiceForm({
  clients,
  folders,
  taxIds,
  today,
  canSetFolder,
  onDraft,
  onIssue,
  onSetFolder,
}: {
  clients: InvoiceClient[];
  folders: Record<string, ClientFolder>;
  /** Each client's tax number from their last invoice that had one. */
  taxIds: Record<string, string>;
  today: string;
  canSetFolder: boolean;
  onDraft: (draft: InvoiceDraft) => void;
  onIssue: (args: InvoiceRequest) => Promise<boolean>;
  onSetFolder: (taskId: string, link: string) => Promise<boolean>;
}) {
  const [s, setS] = useState<State>(() => fresh(today));
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const [folderLink, setFolderLink] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const set = (patch: Partial<State>) => setS(prev => ({ ...prev, ...patch }));
  const chosen = clients.find(c => c.taskId === s.taskId) ?? null;
  const folder = s.taskId ? folders[s.taskId] : undefined;
  const problem = problemOf(s, today);
  const total = cents(s.amount);
  const paidSum = s.payments.reduce((t, p) => t + (cents(p.amount) ?? 0), 0);

  function chooseClient(taskId: string) {
    const c = clients.find(x => x.taskId === taskId);
    setS(prev => ({
      ...prev,
      taskId,
      clientDetail: c?.country ?? "",
      taxId: taxIds[taskId] ?? "",
      amount:
        prev.amount || prev.kind === "paid" || !c?.nextUsd
          ? prev.amount
          : String(c.nextUsd),
      dueDate:
        prev.dueDate ||
        (c?.nextDate && c.nextDate >= today ? c.nextDate.slice(0, 10) : ""),
    }));
    setFolderLink("");
  }

  function setPayment(key: number, patch: Partial<PayLine>) {
    setS(prev => ({
      ...prev,
      payments: prev.payments.map(p =>
        p.key === key ? { ...p, ...patch } : p,
      ),
    }));
  }

  // What the paper shows. Empty fields show their label, never a made-up number.
  const draft = useMemo<InvoiceDraft>(() => {
    const amount = total === null ? "0" : (total / 100).toFixed(2);
    return {
      kind: s.kind,
      client_name: chosen?.name ?? "Client name",
      amount_usd: amount,
      description: s.description.trim() || "Description",
      line_note: s.lineNote.trim() || null,
      client_detail: s.clientDetail.trim() || null,
      client_tax_id: s.taxId.trim() || null,
      period: s.period.trim() || null,
      pay_note: s.payNote.trim() || null,
      issue_date: today,
      due_date: s.kind === "paid" ? null : s.dueDate || today,
      checkout_url:
        s.kind !== "checkout"
          ? null
          : s.linkMode === "whop"
            ? WHOP_PREVIEW
            : s.checkoutUrl.trim(),
      payments:
        s.kind === "paid"
          ? s.payments.map(p => {
              const c = cents(p.amount);
              return {
                date: /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : today,
                method: p.method.trim() || "Method",
                amount: c === null ? "0" : (c / 100).toFixed(2),
                ref: p.ref.trim() || null,
              };
            })
          : [],
    };
  }, [s, chosen, total, today]);

  useEffect(() => onDraft(draft), [draft, onDraft]);

  async function issue() {
    if (problem) return;
    setSending(true);
    const trim = (v: string) => v.trim() || undefined;
    const ok = await onIssue({
      taskId: s.taskId,
      kind: s.kind,
      amount: s.amount.trim(),
      description: s.description.trim(),
      lineNote: trim(s.lineNote),
      clientDetail: trim(s.clientDetail),
      taxId: trim(s.taxId),
      period: trim(s.period),
      payNote: trim(s.payNote),
      dueDate: s.kind === "paid" ? undefined : s.dueDate,
      checkoutUrl:
        s.kind === "checkout" && s.linkMode === "paste"
          ? s.checkoutUrl.trim()
          : undefined,
      createLink:
        s.kind === "checkout" && s.linkMode === "whop" ? true : undefined,
      payments:
        s.kind === "paid"
          ? s.payments.map(p => ({
              date: p.date,
              method: p.method.trim(),
              amount: p.amount.trim(),
              ref: trim(p.ref),
            }))
          : undefined,
    });
    setSending(false);
    setAsking(false);
    if (ok) setS(fresh(today, s.taskId, s.clientDetail, s.taxId));
  }

  async function saveFolder() {
    setSavingFolder(true);
    const ok = await onSetFolder(s.taskId, folderLink.trim());
    setSavingFolder(false);
    if (ok) setFolderLink("");
  }

  const kind = KINDS.find(k => k.key === s.kind) ?? KINDS[0];
  return (
    <form
      className="space-y-6 rounded-2xl border bg-card p-4 sm:p-6"
      onSubmit={e => {
        e.preventDefault();
        if (!problem) setAsking(true);
      }}
    >
      <section className="space-y-4">
        <Kicker>Billed to</Kicker>
        <Field id="inv-client" label="Client">
          <AnimatedSelect
            id="inv-client"
            value={s.taskId}
            onChange={e => chooseClient(e.target.value)}
            className={field}
          >
            <option value="">Pick a client</option>
            {clients.map(c => (
              <option key={c.taskId} value={c.taskId}>
                {c.name}
              </option>
            ))}
          </AnimatedSelect>
        </Field>
        {s.taskId ? (
          <div className="space-y-2 text-xs text-muted-foreground">
            {folder ? (
              <p className="flex flex-wrap items-center gap-1.5">
                <Dot tone="good" />
                Filed in
                <ExtLink
                  href={`https://drive.google.com/drive/folders/${folder.folderId}`}
                >
                  {folder.folderName ?? "the client's Drive folder"}
                </ExtLink>
              </p>
            ) : (
              <p className="flex items-start gap-1.5">
                <span className="mt-1.5">
                  <Dot tone="neutral" />
                </span>
                <span>
                  The worker files it in the Drive folder named "Mahara -{" "}
                  {chosen?.name}" or "{chosen?.name} - Workspace".
                  {canSetFolder
                    ? " If the folder has another name, paste its link below."
                    : null}
                </span>
              </p>
            )}
            {canSetFolder ? (
              <div className="flex gap-2">
                <Input
                  aria-label="Drive folder link"
                  placeholder="https://drive.google.com/drive/folders/..."
                  value={folderLink}
                  onChange={e => setFolderLink(e.target.value)}
                  className="h-8 text-xs md:text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!folderLink.trim() || savingFolder}
                  onClick={saveFolder}
                >
                  {savingFolder ? <Loader2 className="animate-spin" /> : null}
                  {folder ? "Change folder" : "Save folder"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <Field
            id="inv-detail"
            label="Location"
            hint="The line under the client's name."
          >
            <Input
              id="inv-detail"
              maxLength={120}
              placeholder="Jeddah, Saudi Arabia"
              value={s.clientDetail}
              onChange={e => set({ clientDetail: e.target.value })}
            />
          </Field>
          <Field
            id="inv-tax"
            label="Tax number (optional)"
            hint={
              s.taxId && s.taxId === taxIds[s.taskId]
                ? "From this client's last invoice."
                : "Only when the client sent one."
            }
          >
            <Input
              id="inv-tax"
              maxLength={40}
              placeholder="300123456700003"
              className="font-mono tabular-nums"
              value={s.taxId}
              onChange={e => set({ taxId: e.target.value })}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4">
        <Kicker>The invoice</Kicker>
        <div className="space-y-2">
          <PillRow>
            {KINDS.map(k => (
              <Pill
                key={k.key}
                active={k.key === s.kind}
                onClick={() => set({ kind: k.key })}
              >
                {k.label}
              </Pill>
            ))}
          </PillRow>
          <p className="text-xs text-muted-foreground">{kind.hint}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field id="inv-desc" label="Description">
            <Input
              id="inv-desc"
              maxLength={120}
              placeholder="90-day agreement"
              value={s.description}
              onChange={e => set({ description: e.target.value })}
            />
          </Field>
          <Field id="inv-amount" label="Amount (USD)">
            <Input
              id="inv-amount"
              inputMode="decimal"
              placeholder="0.00"
              className="font-mono tabular-nums"
              value={s.amount}
              onChange={e =>
                set({ amount: e.target.value.replace(/[,\s$]/g, "") })
              }
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field id="inv-line" label="Line under it (optional)">
            <Input
              id="inv-line"
              maxLength={200}
              placeholder="Paid in full, covering all 90 days of the agreement"
              value={s.lineNote}
              onChange={e => set({ lineNote: e.target.value })}
            />
          </Field>
          <Field id="inv-period" label="Period (optional)">
            <Input
              id="inv-period"
              maxLength={60}
              placeholder="Days 1-90"
              value={s.period}
              onChange={e => set({ period: e.target.value })}
            />
          </Field>
        </div>
      </section>

      {s.kind === "paid" ? (
        <section className="space-y-3">
          <Kicker>Payments received</Kicker>
          {s.payments.map((p, i) => (
            <div
              key={p.key}
              className={`grid grid-cols-2 gap-2 sm:grid-cols-[9.5rem_minmax(0,1fr)_7rem_2rem] ${i > 0 ? "border-t pt-3" : ""}`}
            >
              <Input
                type="date"
                aria-label={`Payment ${i + 1} date`}
                max={today}
                value={p.date}
                onChange={e => setPayment(p.key, { date: e.target.value })}
              />
              <Input
                aria-label={`Payment ${i + 1} method`}
                list="inv-methods"
                maxLength={40}
                placeholder="Bank transfer"
                value={p.method}
                onChange={e => setPayment(p.key, { method: e.target.value })}
              />
              <Input
                aria-label={`Payment ${i + 1} amount in USD`}
                inputMode="decimal"
                placeholder="0.00"
                className="font-mono tabular-nums"
                value={p.amount}
                onChange={e =>
                  setPayment(p.key, {
                    amount: e.target.value.replace(/[,\s$]/g, ""),
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove payment ${i + 1}`}
                disabled={s.payments.length === 1}
                onClick={() =>
                  set({ payments: s.payments.filter(x => x.key !== p.key) })
                }
                className="h-9 w-8 justify-self-start"
              >
                <X />
              </Button>
              <Input
                className="col-span-2 sm:col-span-3"
                aria-label={`Payment ${i + 1} reference (optional)`}
                maxLength={40}
                placeholder="Reference (optional)"
                value={p.ref}
                onChange={e => setPayment(p.key, { ref: e.target.value })}
              />
            </div>
          ))}
          <datalist id="inv-methods">
            {METHODS.map(m => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={s.payments.length >= MAX_PAYMENTS}
              onClick={() =>
                set({ payments: [...s.payments, blankPayment(today)] })
              }
            >
              <Plus />
              Add a payment
            </Button>
            {total !== null && total > 0 ? (
              <p
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
                aria-live="polite"
              >
                <Dot tone={paidSum === total ? "good" : "warn"} />
                {paidSum === total
                  ? `The payments match the total, ${usd(total)}.`
                  : `The payments add up to ${usd(paidSum)} of ${usd(total)}.`}
              </p>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          <Kicker>Payment</Kicker>
          {s.kind === "checkout" ? (
            <div className="space-y-2">
              <PillRow>
                <Pill
                  active={s.linkMode === "whop"}
                  onClick={() => set({ linkMode: "whop" })}
                >
                  Create a Whop link
                </Pill>
                <Pill
                  active={s.linkMode === "paste"}
                  onClick={() => set({ linkMode: "paste" })}
                >
                  Paste a link
                </Pill>
              </PillRow>
              <p className="text-xs text-muted-foreground">
                {s.linkMode === "whop"
                  ? "The worker creates a private one-time Whop checkout for this amount and puts it on the invoice as a Pay now button."
                  : "Use a payment link you already have. It goes on the invoice as a Pay now button."}
              </p>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
            {s.kind === "checkout" && s.linkMode === "paste" ? (
              <Field id="inv-link" label="Payment link">
                <Input
                  id="inv-link"
                  type="url"
                  maxLength={500}
                  placeholder="https://whop.com/checkout/..."
                  value={s.checkoutUrl}
                  onChange={e => set({ checkoutUrl: e.target.value })}
                />
              </Field>
            ) : (
              <div className="hidden sm:block" />
            )}
            <Field id="inv-due" label="Due date">
              <Input
                id="inv-due"
                type="date"
                value={s.dueDate}
                onChange={e => set({ dueDate: e.target.value })}
              />
            </Field>
          </div>
        </section>
      )}

      <Field
        id="inv-note"
        label="Note to the client (optional)"
        hint="Left empty, the invoice uses the standard note shown on the preview."
      >
        <Textarea
          id="inv-note"
          rows={2}
          maxLength={400}
          value={s.payNote}
          onChange={e => set({ payNote: e.target.value })}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="submit" disabled={Boolean(problem) || sending}>
          Issue invoice
        </Button>
        <p
          className="min-w-0 flex-1 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {problem ??
            "Ready. It gets the next invoice number when it is issued."}
        </p>
      </div>

      <AlertDialog
        open={asking}
        onOpenChange={open => !sending && setAsking(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Issue this invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              {total !== null ? usd(total) : ""} for {chosen?.name}. It gets the
              next invoice number, goes into the client's Drive folder, where
              the client can see it, and is locked against edits.
              {s.kind === "checkout" && s.linkMode === "whop"
                ? " The worker also creates its private Whop payment link first."
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={sending}
              onClick={e => {
                e.preventDefault();
                void issue();
              }}
            >
              {sending ? <Loader2 className="animate-spin" /> : null}
              Issue invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
