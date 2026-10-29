import {
  Copy,
  ExternalLink,
  FileText,
  Plus,
  ReceiptText,
  RefreshCw,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { InvoicePaper } from "../components/invoices/InvoicePaper";
import {
  button,
  buttonPrimary,
  EmptyState,
  Failed,
  field,
  Reading,
  SectionCard,
  Segmented,
  StatusChip,
  type Tone,
} from "../components/kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { day } from "../lib/format";
import {
  addDays,
  canSwitchToWhop,
  cents,
  changeInvoice,
  deskProblem,
  fetchInvoices,
  type InvoiceClient,
  type InvoiceRequest,
  type InvoiceRow,
  type InvoiceStatus,
  type InvoicesData,
  kuwaitToday,
  type PaymentState,
  paymentWord,
  requestInvoice,
} from "../lib/invoices";
import {
  fillInvoice,
  framed,
  type InvoiceDraft,
  type InvoiceKind,
  loadInvoiceTemplate,
  money,
} from "../lib/invoiceTemplate";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";

/**
 * Invoices (Aziz, 2026-10-29: "the same invoices section ... that the CSM has
 * for the deposit, with the same payment processors ... If the ecom link
 * doesn't work, they can generate a WHOP link as well and make the invoice.
 * It's very professional."). A closer makes the deposit invoice here and sees
 * the page the client gets as it is typed; the invoice worker numbers it,
 * makes the link, prints the PDF and files it in the client's Drive folder.
 */

type LinkMode = "ecom" | "whop" | "paste";

const KINDS: { key: InvoiceKind; label: string; hint: string }[] = [
  {
    key: "checkout",
    label: "Pay online",
    hint: "The client pays by a payment link before the due date.",
  },
  {
    key: "paid",
    label: "Paid",
    hint: "Proof of money already received, with each payment listed.",
  },
  {
    key: "autocharge",
    label: "Card on file",
    hint: "The card on file is charged on the due date. Nothing for the client to do.",
  },
];

const LINKS: { key: LinkMode; label: string; hint: string }[] = [
  {
    key: "ecom",
    label: "Ecom link",
    hint: "KNET and cards, charged in KWD at today's rate. The usual one.",
  },
  {
    key: "whop",
    label: "Whop link",
    hint: "Cards and Apple Pay, charged in USD. Use it when Ecom does not work for the client.",
  },
  {
    key: "paste",
    label: "Paste a link",
    hint: "A link you already made somewhere else.",
  },
];

/** The words a deposit invoice usually carries; one tap fills the description. */
const DESCRIPTIONS = [
  "Deposit",
  "Deposit + first payment",
  "First payment",
  "90-day agreement",
];

const METHODS = ["Bank transfer", "Card", "Ecom", "Whop", "Tap", "Cash"];
const MAX_PAYMENTS = 12;
const TAX_ID = /^[A-Za-z0-9][A-Za-z0-9 ./-]{0,39}$/;
/** What the preview's Pay now button points at until the worker makes the real link. */
const PREVIEW_LINK: Record<"ecom" | "whop", string> = {
  ecom: "https://invoice.ecom.io/",
  whop: "https://whop.com/checkout/",
};

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
  linkMode: LinkMode;
  checkoutUrl: string;
  payments: PayLine[];
};

let nextKey = 1;
const blankPayment = (today: string): PayLine => ({
  key: nextKey++,
  date: today,
  method: "Bank transfer",
  amount: "",
  ref: "",
});

const fresh = (today: string): State => ({
  taskId: "",
  kind: "checkout",
  amount: "",
  description: "Deposit",
  lineNote: "",
  clientDetail: "",
  taxId: "",
  period: "",
  payNote: "",
  dueDate: addDays(today, 3),
  linkMode: "ecom",
  checkoutUrl: "",
  payments: [blankPayment(today)],
});

const usd = (c: number) => `USD ${money((c / 100).toFixed(2))}`;

/** The first thing still missing, in the database's own words; null when ready. */
function problemOf(s: State, today: string): string | null {
  if (!s.taskId) return "Pick the client.";
  if (s.taxId.trim() && !TAX_ID.test(s.taxId.trim()))
    return "Type the tax number with letters, numbers, spaces, dots or dashes only.";
  const total = cents(s.amount);
  if (total === null)
    return "Type the amount in US dollars, for example 1500 or 1500.50.";
  if (total <= 0) return "The amount must be more than 0.";
  if (!s.description.trim())
    return 'Type a description, for example "Deposit".';
  if (
    s.kind === "checkout" &&
    s.linkMode === "paste" &&
    !/^https:\/\/[^\s<>"']+$/.test(s.checkoutUrl.trim())
  )
    return "Paste the full payment link, starting with https://.";
  if (s.kind !== "paid" && !s.dueDate)
    return "Pick the date the payment is due.";
  if (s.kind !== "paid" && s.dueDate < today)
    return "The due date has passed. Pick today or a later day.";
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
    if (sum !== total)
      return `The payments add up to ${usd(sum)}, but the invoice total is ${usd(total)}. Make them match.`;
  }
  return null;
}

/** The request the database checks, from the form. */
function requestOf(s: State): InvoiceRequest {
  const trim = (v: string) => v.trim() || undefined;
  return {
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
      s.kind === "checkout" && s.linkMode !== "paste" ? true : undefined,
    provider:
      s.kind === "checkout" && s.linkMode !== "paste" ? s.linkMode : undefined,
    payments:
      s.kind === "paid"
        ? s.payments.map(p => ({
            date: p.date,
            method: p.method.trim(),
            amount: p.amount.trim(),
            ref: trim(p.ref),
          }))
        : undefined,
  };
}

const message = (e: unknown) =>
  e instanceof Error ? e.message : "The database did not answer. Try again.";

export default function InvoicesPage({ me }: { me: Me }) {
  const [data, setData] = useState<InvoicesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const today = useMemo(() => kuwaitToday(), []);
  const [s, setS] = useState<State>(() => fresh(today));
  const set = (patch: Partial<State>) => setS(prev => ({ ...prev, ...patch }));
  const formTop = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchInvoices());
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, []);
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

  // While an invoice is waiting or being made, look again every few seconds.
  const pending = data?.invoices.some(
    i => i.status === "queued" || i.status === "rendering",
  );
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    return () => window.clearInterval(t);
  }, [pending, load]);

  const clients = data?.clients ?? [];
  const chosen = clients.find(c => c.taskId === s.taskId) ?? null;
  // Each client's tax number from their newest invoice that had one.
  const taxIds = useMemo(() => {
    const out: Record<string, string> = {};
    for (const i of data?.invoices ?? [])
      if (i.client_tax_id && !(i.clickup_task_id in out))
        out[i.clickup_task_id] = i.client_tax_id;
    return out;
  }, [data]);

  const total = cents(s.amount);
  const draft = useMemo<InvoiceDraft>(() => {
    const amount = total === null ? "0" : (total / 100).toFixed(2);
    const made = s.kind === "checkout" && s.linkMode !== "paste";
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
      checkout_source: made ? (s.linkMode as "ecom" | "whop") : "pasted",
      checkout_url:
        s.kind !== "checkout"
          ? null
          : made
            ? PREVIEW_LINK[s.linkMode as "ecom" | "whop"]
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
    } as InvoiceDraft;
  }, [s, chosen, total, today]);

  // The paper follows the form a moment after typing stops.
  useEffect(() => {
    if (!template) return;
    const t = window.setTimeout(() => {
      try {
        setHtml(framed(fillInvoice(draft, "INV-PREVIEW", template)));
      } catch {
        // A half-typed value; the last good page stays up.
      }
    }, 120);
    return () => window.clearTimeout(t);
  }, [template, draft]);

  const chooseClient = (c: InvoiceClient | null) =>
    setS(prev => ({
      ...prev,
      taskId: c?.taskId ?? "",
      clientDetail: c?.country ?? "",
      taxId: c ? (taxIds[c.taskId] ?? "") : "",
    }));

  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const problem = problemOf(s, today);
  const issue = async () => {
    if (problem) return;
    setSending(true);
    try {
      await requestInvoice(requestOf(s));
      toast.success(
        "Making the invoice. It shows as Ready in a minute or two, with its PDF and payment link.",
      );
      setS(prev => ({
        ...fresh(today),
        taskId: prev.taskId,
        clientDetail: prev.clientDetail,
        taxId: prev.taxId,
      }));
      setAsking(false);
      await load();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setSending(false);
    }
  };

  /** The same invoice again as a Whop link, in the form, for the rep to check and make. */
  const againWithWhop = (i: InvoiceRow) => {
    setS({
      ...fresh(today),
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
        i.due_date && i.due_date >= today ? i.due_date : addDays(today, 3),
      linkMode: "whop",
    });
    formTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    toast.success(
      "The form has the same invoice with a Whop link. Check it, then make it.",
    );
  };

  const desk = data ? deskProblem(data.desk) : null;
  const kind = KINDS.find(k => k.key === s.kind) ?? KINDS[0];
  const paidSum = s.payments.reduce((t, p) => t + (cents(p.amount) ?? 0), 0);
  const mine = (data?.invoices ?? []).filter(
    i => me.manager || i.requested_by === (me.email ?? "").toLowerCase(),
  );

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 md:px-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Invoices</h1>
        <p className="muted text-sm">
          Deposits and payments, made the same way client success makes them:
          numbered, filed in the client's Drive folder and on the invoice
          register, with an Ecom or Whop link to pay.
        </p>
      </header>
      {error ? (
        <Failed what="The invoices" error={error} retry={() => void load()} />
      ) : null}
      {desk ? (
        <p className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          {desk}
        </p>
      ) : null}

      <div
        ref={formTop}
        className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      >
        <SectionCard title="New invoice">
          <form
            className="space-y-5"
            onSubmit={e => {
              e.preventDefault();
              if (!problem) setAsking(true);
            }}
          >
            <ClientPicker
              clients={clients}
              chosen={chosen}
              loading={!data && !error}
              onChoose={chooseClient}
            />

            <div className="space-y-1.5">
              <Segmented
                label="Invoice type"
                value={s.kind}
                options={KINDS.map(k => [k.key, k.label])}
                onChange={v => set({ kind: v as InvoiceKind })}
              />
              <p className="muted text-xs">{kind.hint}</p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <Field label="Amount (USD)" id="inv-amount">
                <input
                  id="inv-amount"
                  inputMode="decimal"
                  value={s.amount}
                  onChange={e => set({ amount: e.target.value })}
                  placeholder="1500"
                  className={`${field} font-mono`}
                />
              </Field>
              <Field label="Description" id="inv-desc">
                <input
                  id="inv-desc"
                  value={s.description}
                  onChange={e => set({ description: e.target.value })}
                  maxLength={120}
                  className={field}
                  dir="auto"
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {DESCRIPTIONS.map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => set({ description: d })}
                      aria-pressed={s.description === d}
                      className={`rounded-full border hairline px-2.5 py-0.5 text-xs ${s.description === d ? "bg-[color:var(--secondary)] font-medium" : "muted hover:text-[color:var(--foreground)]"}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            {s.kind === "checkout" ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Payment link</p>
                <div
                  role="radiogroup"
                  aria-label="Payment link"
                  className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                >
                  {LINKS.map(l => (
                    <button
                      key={l.key}
                      type="button"
                      role="radio"
                      aria-checked={s.linkMode === l.key}
                      onClick={() => set({ linkMode: l.key })}
                      className={`rounded-[14px] border p-3 text-start transition-colors ${s.linkMode === l.key ? "border-[color:var(--mahara-teal)] bg-[color:color-mix(in_oklch,var(--primary)_10%,transparent)]" : "hairline hover:bg-[color:var(--muted)]"}`}
                    >
                      <span className="block text-sm font-medium">
                        {l.label}
                      </span>
                      <span className="muted mt-0.5 block text-xs leading-snug">
                        {l.hint}
                      </span>
                    </button>
                  ))}
                </div>
                {s.linkMode === "paste" ? (
                  <input
                    value={s.checkoutUrl}
                    onChange={e => set({ checkoutUrl: e.target.value })}
                    placeholder="https://"
                    aria-label="Payment link"
                    className={field}
                  />
                ) : null}
              </div>
            ) : null}

            {s.kind !== "paid" ? (
              <Field label="Due date" id="inv-due">
                <input
                  id="inv-due"
                  type="date"
                  min={today}
                  value={s.dueDate}
                  onChange={e => set({ dueDate: e.target.value })}
                  className={`${field} max-w-[12rem]`}
                />
              </Field>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium">Payments received</p>
                {s.payments.map(p => (
                  <div
                    key={p.key}
                    className="grid grid-cols-2 gap-2 sm:grid-cols-[9.5rem_8rem_7rem_minmax(0,1fr)_2rem]"
                  >
                    <input
                      type="date"
                      max={today}
                      value={p.date}
                      aria-label="Day it arrived"
                      onChange={e =>
                        setS(prev => ({
                          ...prev,
                          payments: prev.payments.map(x =>
                            x.key === p.key
                              ? { ...x, date: e.target.value }
                              : x,
                          ),
                        }))
                      }
                      className={field}
                    />
                    <select
                      value={p.method}
                      aria-label="Method"
                      onChange={e =>
                        setS(prev => ({
                          ...prev,
                          payments: prev.payments.map(x =>
                            x.key === p.key
                              ? { ...x, method: e.target.value }
                              : x,
                          ),
                        }))
                      }
                      className={field}
                    >
                      {METHODS.map(m => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                    <input
                      inputMode="decimal"
                      value={p.amount}
                      placeholder="USD"
                      aria-label="Amount in US dollars"
                      onChange={e =>
                        setS(prev => ({
                          ...prev,
                          payments: prev.payments.map(x =>
                            x.key === p.key
                              ? { ...x, amount: e.target.value }
                              : x,
                          ),
                        }))
                      }
                      className={`${field} font-mono`}
                    />
                    <input
                      value={p.ref}
                      placeholder="Reference (optional)"
                      aria-label="Reference"
                      onChange={e =>
                        setS(prev => ({
                          ...prev,
                          payments: prev.payments.map(x =>
                            x.key === p.key ? { ...x, ref: e.target.value } : x,
                          ),
                        }))
                      }
                      className={field}
                    />
                    <button
                      type="button"
                      aria-label="Remove this payment"
                      disabled={s.payments.length === 1}
                      onClick={() =>
                        setS(prev => ({
                          ...prev,
                          payments: prev.payments.filter(x => x.key !== p.key),
                        }))
                      }
                      className="muted flex size-9 items-center justify-center rounded-full hover:bg-[color:var(--muted)] disabled:opacity-30"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={s.payments.length >= MAX_PAYMENTS}
                    onClick={() =>
                      setS(prev => ({
                        ...prev,
                        payments: [...prev.payments, blankPayment(today)],
                      }))
                    }
                    className="muted inline-flex items-center gap-1 text-xs hover:text-[color:var(--foreground)] disabled:opacity-40"
                  >
                    <Plus className="size-3.5" aria-hidden /> Add a payment
                  </button>
                  <span className="muted font-mono text-xs">
                    {usd(paidSum)}
                    {total !== null ? ` of ${usd(total)}` : ""}
                  </span>
                </div>
              </div>
            )}

            <details className="group rounded-[14px] border hairline px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">
                More on the invoice
                <span className="muted ms-2 text-xs font-normal">
                  location, tax number, period, a note
                </span>
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Line under the description" id="inv-line">
                  <input
                    id="inv-line"
                    value={s.lineNote}
                    maxLength={200}
                    onChange={e => set({ lineNote: e.target.value })}
                    className={field}
                    dir="auto"
                  />
                </Field>
                <Field label="Period" id="inv-period">
                  <input
                    id="inv-period"
                    value={s.period}
                    maxLength={60}
                    placeholder="Nov 2026"
                    onChange={e => set({ period: e.target.value })}
                    className={field}
                  />
                </Field>
                <Field label="Client location" id="inv-loc">
                  <input
                    id="inv-loc"
                    value={s.clientDetail}
                    maxLength={120}
                    onChange={e => set({ clientDetail: e.target.value })}
                    className={field}
                    dir="auto"
                  />
                </Field>
                <Field label="Tax number" id="inv-tax">
                  <input
                    id="inv-tax"
                    value={s.taxId}
                    maxLength={40}
                    onChange={e => set({ taxId: e.target.value })}
                    className={field}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Note to the client" id="inv-note">
                    <textarea
                      id="inv-note"
                      value={s.payNote}
                      maxLength={400}
                      rows={2}
                      onChange={e => set({ payNote: e.target.value })}
                      className={`${field} h-auto py-2`}
                      dir="auto"
                    />
                  </Field>
                </div>
              </div>
            </details>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t hairline pt-4">
              <p className={`text-xs ${problem ? "muted" : ""}`}>
                {problem ??
                  `Ready: ${usd(total ?? 0)} to ${chosen?.name ?? "the client"}.`}
              </p>
              <button
                type="submit"
                disabled={Boolean(problem) || sending}
                className={buttonPrimary}
              >
                <ReceiptText className="size-4" aria-hidden /> Make the invoice
              </button>
            </div>
          </form>
        </SectionCard>

        <div className="min-w-0 lg:sticky lg:top-14 lg:self-start">
          <InvoicePaper
            html={html}
            caption="The page the client gets. The number and the payment link are added when it is made."
          />
        </div>
      </div>

      <SectionCard
        title={me.manager ? "Invoices" : "Your invoices"}
        side={
          <button
            type="button"
            onClick={() => void load()}
            className="muted inline-flex items-center gap-1 text-xs hover:text-[color:var(--foreground)]"
          >
            <RefreshCw className="size-3" aria-hidden /> Read again
          </button>
        }
        flush
      >
        {!data && !error ? (
          <Reading what="the invoices" className="px-4 py-3 text-sm" />
        ) : mine.length ? (
          <ul className="divide-y hairline">
            {mine.map(i => (
              <InvoiceItem
                key={i.id}
                i={i}
                paid={data?.paid[i.id]}
                onChanged={load}
                onWhop={againWithWhop}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            compact
            icon={FileText}
            title="No invoices yet"
            text="The invoices you make show here with their PDF, their payment link and whether they were paid."
          />
        )}
      </SectionCard>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Make this invoice?</DialogTitle>
            <DialogDescription>
              {usd(total ?? 0)} to {chosen?.name ?? "the client"} for "
              {s.description.trim()}".{" "}
              {s.kind === "checkout"
                ? s.linkMode === "paste"
                  ? "It carries the link you pasted."
                  : `The worker makes ${s.linkMode === "whop" ? "a Whop" : "an Ecom"} link for it.`
                : s.kind === "paid"
                  ? "It is marked paid in full."
                  : "The card on file is charged on the due date."}{" "}
              It is numbered, filed in the client's Drive folder and added to
              the invoice register. Nothing is sent to the client: you share the
              PDF and the link.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className={button}
            >
              Back
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() => void issue()}
              className={buttonPrimary}
            >
              {sending ? "Making it…" : "Make the invoice"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Type a few letters of the client; the billing sheet's clients that match. */
function ClientPicker({
  clients,
  chosen,
  loading,
  onChoose,
}: {
  clients: InvoiceClient[];
  chosen: InvoiceClient | null;
  loading: boolean;
  onChoose: (c: InvoiceClient | null) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (
      t ? clients.filter(c => c.name.toLowerCase().includes(t)) : clients
    ).slice(0, 8);
  }, [q, clients]);
  if (chosen)
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Client</p>
        <div className="flex items-center justify-between gap-2 rounded-[14px] border hairline px-3.5 py-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium" dir="auto">
              {chosen.name}
            </span>
            <span className="muted block truncate text-xs">
              {[chosen.country, chosen.plan, chosen.status]
                .filter(Boolean)
                .join(" · ") || "On the billing sheet"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onChoose(null)}
            className="muted shrink-0 text-xs underline-offset-4 hover:underline"
          >
            Change
          </button>
        </div>
      </div>
    );
  return (
    <div className="relative space-y-1.5">
      <label htmlFor="inv-client" className="block text-sm font-medium">
        Client
      </label>
      <input
        id="inv-client"
        value={q}
        onChange={e => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder={
          loading ? "Reading the clients…" : "Type the client's name"
        }
        autoComplete="off"
        className={field}
        dir="auto"
      />
      <p className="muted text-xs">
        Clients come from the billing sheet: a new client shows once their New
        Client Form is in and their ClickUp card is made.
      </p>
      {open && matches.length ? (
        <ul className="absolute inset-x-0 top-[4.5rem] z-20 max-h-72 overflow-y-auto rounded-[14px] border hairline bg-[color:var(--card)] py-1 shadow-xl">
          {matches.map(c => (
            <li key={c.taskId}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  onChoose(c);
                  setQ("");
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-[color:var(--muted)]"
              >
                <span className="truncate" dir="auto">
                  {c.name}
                </span>
                <span className="muted shrink-0 text-xs">
                  {c.country ?? ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && q.trim() && !matches.length ? (
        <p className="text-xs">
          No client on the billing sheet matches "{q.trim()}".
        </p>
      ) : null}
    </div>
  );
}

const STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  queued: { label: "Waiting", tone: "neutral" },
  rendering: { label: "Being made", tone: "neutral" },
  issued: { label: "Ready", tone: "good" },
  failed: { label: "Did not go through", tone: "critical" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const SOURCE_WORD: Record<string, string> = {
  ecom: "Ecom link",
  whop: "Whop link",
  pasted: "Pasted link",
};

function InvoiceItem({
  i,
  paid,
  onChanged,
  onWhop,
}: {
  i: InvoiceRow;
  paid: PaymentState | undefined;
  onChanged: () => Promise<void>;
  onWhop: (i: InvoiceRow) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const status = STATUS[i.status];
  const pay = paymentWord(i, paid);
  const act = async (change: "cancel" | "retry" | "whop") => {
    setBusy(change);
    try {
      await changeInvoice(i.id, change);
      toast.success(
        change === "cancel"
          ? "Cancelled."
          : change === "whop"
            ? "Going out again with a Whop link."
            : "Trying again.",
      );
      await onChanged();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(null);
    }
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied.`);
    } catch {
      toast.error("The browser would not copy. Open it and copy the address.");
    }
  };
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-mono font-medium">{i.invoice_no ?? "—"}</span>
          <span className="truncate font-medium" dir="auto">
            {i.client_name}
          </span>
          <StatusChip tone={status.tone} label={status.label} />
          {pay ? (
            <StatusChip
              tone={pay.tone}
              label={pay.text}
              title={paid?.paid_at ? `Paid ${day(paid.paid_at)}` : undefined}
            />
          ) : null}
        </p>
        <p className="muted mt-0.5 truncate text-xs" dir="auto">
          <span className="font-mono">USD {money(i.amount_usd)}</span>
          {i.amount_kwd ? (
            <span className="font-mono"> (KWD {money(i.amount_kwd)})</span>
          ) : null}{" "}
          · {i.description}
          {i.kind === "checkout"
            ? ` · ${SOURCE_WORD[i.checkout_source] ?? "Link"}`
            : i.kind === "paid"
              ? " · Paid"
              : " · Card on file"}
          {i.due_date ? ` · due ${day(i.due_date)}` : ""} ·{" "}
          {i.requested_by.split("@")[0]} {day(i.requested_at)}
        </p>
        {i.status === "failed" && i.error ? (
          <p className="mt-1 text-xs" style={{ color: "var(--destructive)" }}>
            {i.error}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        {i.drive_url ? (
          <>
            <a
              href={i.drive_url}
              target="_blank"
              rel="noreferrer noopener"
              className={`${button} h-8 px-3 text-xs`}
            >
              <ExternalLink className="size-3.5" aria-hidden /> PDF
            </a>
            <button
              type="button"
              onClick={() => void copy(i.drive_url ?? "", "The PDF link")}
              className={`${button} h-8 px-3 text-xs`}
            >
              <Copy className="size-3.5" aria-hidden /> PDF link
            </button>
          </>
        ) : null}
        {i.checkout_url && i.status === "issued" ? (
          <button
            type="button"
            onClick={() => void copy(i.checkout_url ?? "", "The payment link")}
            className={`${button} h-8 px-3 text-xs`}
          >
            <Copy className="size-3.5" aria-hidden /> Payment link
          </button>
        ) : null}
        {canSwitchToWhop(i) ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act("whop")}
            className={`${buttonPrimary} h-8 px-3 text-xs`}
          >
            {busy === "whop" ? "Switching…" : "Use a Whop link instead"}
          </button>
        ) : null}
        {i.kind === "checkout" &&
        i.checkout_source === "ecom" &&
        i.status === "issued" &&
        pay?.text !== "Paid" ? (
          <button
            type="button"
            onClick={() => onWhop(i)}
            title="Ecom does not work for this client: make the same invoice with a Whop link"
            className={`${button} h-8 px-3 text-xs`}
          >
            Same invoice with Whop
          </button>
        ) : null}
        {i.status === "failed" ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act("retry")}
            className={`${button} h-8 px-3 text-xs`}
          >
            {busy === "retry" ? "Trying…" : "Try again"}
          </button>
        ) : null}
        {i.status === "queued" || i.status === "failed" ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act("cancel")}
            className={`${button} h-8 px-3 text-xs`}
          >
            {busy === "cancel" ? "Cancelling…" : "Cancel"}
          </button>
        ) : null}
      </div>
    </li>
  );
}
