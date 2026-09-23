import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import {
  CopyCheck,
  HandCoins,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useId,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { type Column, DataTable } from "@/components/ceo/DataTable";
import { EmptyState } from "@/components/ceo/EmptyState";
import {
  count,
  date,
  dateTime,
  isNum,
  money,
  month,
  pct,
  plural,
  shiftMonth,
} from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip, type StatusTone } from "@/components/ceo/StatusChip";
import type { CeoSection } from "@/components/ceo/useCeo";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ManualPaymentRefusal } from "../../../convex/ceo/manualPayments";
import type {
  ManualPaymentRow,
  ManualRail,
  MoneyPayload,
  Note,
  PossibleDuplicate,
} from "../../../convex/ceo/payloads";

/**
 * Payments Aziz logs by hand (decision of 2026-09-16): the form, this
 * month's entries with remove and restore, and the possible duplicates. The
 * writes are convex/ceo/manualPayments.ts; the totals come from the money
 * section, which recomputes about a minute after each change, so this file
 * never adds an entry into a total itself.
 */

type Currency = "USD" | "KWD";
type ListRow = FunctionReturnType<typeof api.ceo.manualPayments.list>[number];

export const RAIL_LABEL: Record<ManualRail, string> = {
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  cash: "Cash",
  tap: "Tap",
  other: "Other",
};
const RAILS: ManualRail[] = ["bank_transfer", "cheque", "cash", "tap", "other"];

/** The same bounds the server checks (writeGuard.ts). */
const FIRST_DAY = "2025-01-01";
const MAX_AMOUNT = 1_000_000;

const round2 = (x: number) => Math.round(x * 100) / 100;

/** "460.125 KWD", digits grouped, trailing zeros dropped. */
function typed(amount: number, currency: Currency): string {
  const [whole, frac] = amount
    .toFixed(3)
    .replace(/\.?0+$/, "")
    .split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}${frac ? `.${frac}` : ""} ${currency}`;
}

/** What a refused write says, in the words the server wrote. */
function refusal(e: unknown): ManualPaymentRefusal {
  if (e instanceof ConvexError) {
    const data = e.data as Partial<ManualPaymentRefusal> | string | undefined;
    if (typeof data === "string") return { code: "refused", message: data };
    if (data && typeof data.message === "string")
      return {
        code: data.code === "repeat" ? "repeat" : "refused",
        message: data.message,
      };
  }
  return {
    code: "refused",
    message:
      "The cockpit could not save this, so nothing changed. Try again in a minute.",
  };
}

/** A typed amount, or the sentence that says what is wrong with it. */
function parseAmount(raw: string, currency: Currency): number | string {
  const text = raw.trim().replace(/,/g, "");
  if (!text) return "Type an amount.";
  if (!/^\d+(\.\d+)?$/.test(text))
    return "Use digits only, like 1500 or 460.125.";
  const decimals = currency === "USD" ? 2 : 3;
  if ((text.split(".")[1] ?? "").length > decimals)
    return currency === "USD"
      ? "USD has at most two decimals."
      : "KWD has at most three decimals.";
  const n = Number(text);
  if (!(n > 0)) return "The amount must be above 0.";
  if (n > MAX_AMOUNT)
    return `That is over 1,000,000 ${currency}. Check it and type it again.`;
  return n;
}

// --- Shared bits ---

function Problem({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed text-foreground"
    >
      <TriangleAlert
        className="mt-0.5 size-3.5 shrink-0"
        style={{ color: "var(--ceo-warning)" }}
        aria-hidden
      />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function FormField({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {error ? (
        <p
          id={`${id}-msg`}
          className="flex items-start gap-1.5 text-xs leading-relaxed text-foreground"
        >
          <TriangleAlert
            className="mt-0.5 size-3 shrink-0"
            style={{ color: "var(--ceo-warning)" }}
            aria-hidden
          />
          <span className="min-w-0">{error}</span>
        </p>
      ) : hint ? (
        <p
          id={`${id}-msg`}
          className="text-xs leading-relaxed text-muted-foreground"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </>
  );
}

// --- The form ---

type Draft = {
  day: string;
  /** "payment" for money received, "refund" for money given back. */
  kind: "payment" | "refund";
  amount: string;
  currency: Currency;
  client: string;
  rail: ManualRail | "";
  deal: string;
  note: string;
};

type Ready = {
  day: string;
  kind: "payment" | "refund";
  amount: number;
  currency: Currency;
  clientName: string;
  card: { name: string; clickupTaskId: string } | null;
  rail: ManualRail;
  deal: number | null;
  note: string | null;
  /** Preview only: the server converts and stores the real figure. */
  usd: number | null;
  dealUsd: number | null;
};

type ClientOption = FunctionReturnType<
  typeof api.ceo.manualPayments.clientOptions
>[number];

const nameMatch = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function validate(
  d: Draft,
  today: string,
  tapLive: boolean,
  card: ClientOption | null,
  usdPerKwd: number | null,
): { errors: Partial<Record<keyof Draft, string>>; ready: Ready | null } {
  const errors: Partial<Record<keyof Draft, string>> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.day))
    errors.day = "Pick the day it arrived.";
  else if (d.day < FIRST_DAY) errors.day = "The log starts on 1 Jan 2025.";
  else if (d.day > today) errors.day = "The day cannot be in the future.";

  const amount = parseAmount(d.amount, d.currency);
  if (typeof amount === "string") errors.amount = amount;

  const clientName = d.client.trim().replace(/\s+/g, " ");
  if (!clientName) errors.client = "Type or pick the client.";
  else if (clientName.length > 120)
    errors.client = "Keep the name under 120 characters.";

  if (!d.rail) errors.rail = "Pick how the money arrived.";
  else if (d.rail === "tap" && tapLive)
    errors.rail =
      "Tap is connected, so Tap payments reach the Tap rail by themselves. Logging one here would count it twice.";

  let deal: number | null = null;
  if (d.deal.trim()) {
    const parsed = parseAmount(d.deal, d.currency);
    if (typeof parsed === "string") errors.deal = parsed;
    else deal = parsed;
  }
  const note = d.note.trim().replace(/\s+/g, " ");
  if (note.length > 500) errors.note = "Keep the note under 500 characters.";

  if (Object.keys(errors).length || typeof amount === "string" || !d.rail)
    return { errors, ready: null };
  const toUsd = (x: number) =>
    d.currency === "USD"
      ? x
      : usdPerKwd === null
        ? null
        : round2(x * usdPerKwd);
  return {
    errors,
    ready: {
      day: d.day,
      kind: d.kind,
      amount,
      currency: d.currency,
      clientName,
      card: card
        ? { name: card.name, clickupTaskId: card.clickupTaskId }
        : null,
      rail: d.rail,
      deal,
      note: note || null,
      usd: toUsd(amount),
      dealUsd: deal === null ? null : toUsd(deal),
    },
  };
}

const blank = (day: string, currency: Currency): Draft => ({
  day,
  kind: "payment",
  amount: "",
  currency,
  client: "",
  rail: "",
  deal: "",
  note: "",
});

/** "$1,500", or "460.125 KWD, about $1,500.01" while the rate is known. */
function amountWords(amount: number, currency: Currency, usd: number | null) {
  if (currency === "USD") return money(amount);
  return usd === null
    ? typed(amount, currency)
    : `${typed(amount, currency)}, about ${money(usd)}`;
}

type RecentDeal = MoneyPayload["deals"]["recent"][number];

/**
 * Closer form deals with a value in the month of `day`, from the money
 * section's newest ten. The deal check matches on client names, and a client
 * the closer typed under another name ("mergestudio.kw" for "Something Studio
 * KW") only matches when its ClickUp card lists both, so the form shows these
 * beside the deal value for a look before anything is saved.
 */
function formDealsIn(
  recent: RecentDeal[] | null,
  day: string,
): { business: string; date: string; contracted: number }[] {
  if (!recent || !/^\d{4}-\d{2}/.test(day)) return [];
  const m = day.slice(0, 7);
  return recent.flatMap(d =>
    d.date.slice(0, 7) === m && isNum(d.contracted)
      ? [
          {
            business: d.business ?? "No business name",
            date: d.date,
            contracted: d.contracted,
          },
        ]
      : [],
  );
}

function FormDeals({
  deals,
  className,
}: {
  deals: { business: string; date: string; contracted: number }[];
  className?: string;
}) {
  if (!deals.length) return null;
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs leading-relaxed",
        className,
      )}
    >
      <p className="text-foreground">
        The closer form already has {plural(deals.length, "deal")} this month,
        among its newest ten. If this payment belongs to one of them, leave the
        deal value empty, even when the names differ:
      </p>
      <ul className="mt-1 text-muted-foreground">
        {deals.map(d => (
          <li key={`${d.business}-${d.date}`} className="tabular-nums">
            {d.business}, {money(d.contracted)}, {date(d.date)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LogPaymentCard({
  today,
  recentDeals,
  order,
}: {
  /** Kuwait day, from the server when known. */
  today: string;
  /** The money section's newest closer form deals, or null before it is computed. */
  recentDeals: RecentDeal[] | null;
  order: number;
}) {
  const info = useQuery(api.ceo.manualPayments.formInfo);
  const options = useQuery(api.ceo.manualPayments.clientOptions);
  const add = useMutation(api.ceo.manualPayments.add);
  const base = useId();
  const id = (k: string) => `${base}-${k}`;
  // The later of the two: a query result is not re-run when the day turns,
  // so a tab left open overnight would otherwise refuse today.
  const day = info?.today && info.today > today ? info.today : today;
  const [draft, setDraft] = useState<Draft>(() => blank(day, "USD"));
  const [showErrors, setShowErrors] = useState(false);
  const [confirm, setConfirm] = useState<Ready | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ManualPaymentRefusal | null>(null);

  const card = useMemo(() => {
    const key = nameMatch(draft.client);
    if (!key || !options) return null;
    return options.find(o => nameMatch(o.name) === key) ?? null;
  }, [draft.client, options]);
  const { errors, ready } = validate(
    draft,
    day,
    info?.tapLive ?? false,
    card,
    info?.usdPerKwd ?? null,
  );
  const shown = showErrors ? errors : {};
  const set =
    <K extends keyof Draft>(k: K) =>
    (value: Draft[K]) =>
      setDraft(d => ({ ...d, [k]: value }));

  const kwdHint =
    draft.currency === "KWD" && info
      ? `Converted when it is saved at the cockpit's fixed rate, 1 KWD = ${money(info.usdPerKwd)}.`
      : undefined;
  const amountNow = parseAmount(draft.amount, draft.currency);
  const dealNow = draft.deal.trim()
    ? parseAmount(draft.deal, draft.currency)
    : null;
  const dealLow =
    typeof amountNow === "number" &&
    typeof dealNow === "number" &&
    dealNow < amountNow;
  const formDeals = formDealsIn(recentDeals, draft.day);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    if (!ready) return;
    setProblem(null);
    setConfirm(ready);
  };

  const send = async (allowRepeat: boolean) => {
    if (!confirm || pending) return;
    setPending(true);
    try {
      await add({
        day: confirm.day,
        amount: confirm.amount,
        currency: confirm.currency,
        clientName: confirm.clientName,
        rail: confirm.rail,
        ...(confirm.kind === "refund" ? { kind: "refund" as const } : {}),
        ...(confirm.card ? { clickupTaskId: confirm.card.clickupTaskId } : {}),
        ...(confirm.deal !== null ? { dealContracted: confirm.deal } : {}),
        ...(confirm.note ? { note: confirm.note } : {}),
        ...(allowRepeat ? { allowRepeat: true } : {}),
      });
      const elsewhere = confirm.day.slice(0, 7) !== day.slice(0, 7);
      toast.success(
        elsewhere
          ? `Logged for ${month(confirm.day, { long: true, year: true })}. Pick that month in the list below to see it. Totals update in about a minute.`
          : "Logged. Totals update in about a minute.",
      );
      setConfirm(null);
      setProblem(null);
      setShowErrors(false);
      setDraft(d => blank(d.day, d.currency));
    } catch (err) {
      setProblem(refusal(err));
    } finally {
      setPending(false);
    }
  };

  // Every field but the day and the note always shows a hint line.
  const describe = (k: keyof Draft) =>
    shown[k] || (k !== "day" && k !== "note") ? `${id(k)}-msg` : undefined;

  return (
    <SectionCard
      kicker="Bank transfer, cheque, cash, or Tap while Tap is not connected"
      title="Log a payment"
      order={order}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
          <FormField id={id("day")} label="Day received" error={shown.day}>
            <DateInput
              id={id("day")}
              min={FIRST_DAY}
              max={day}
              value={draft.day}
              onChange={e => set("day")(e.target.value)}
              aria-invalid={Boolean(shown.day)}
              aria-describedby={describe("day")}
            />
          </FormField>

          <FormField
            id={id("amount")}
            label="Amount received"
            error={shown.amount}
            hint={
              kwdHint ?? "Cash that actually arrived, not the contract value."
            }
          >
            <div className="flex min-w-0 gap-2">
              <Input
                id={id("amount")}
                inputMode="decimal"
                autoComplete="off"
                placeholder={draft.currency === "USD" ? "1500" : "460.125"}
                value={draft.amount}
                onChange={e => set("amount")(e.target.value)}
                aria-invalid={Boolean(shown.amount)}
                aria-describedby={describe("amount")}
                className="min-w-0 flex-1"
              />
              <Select
                value={draft.currency}
                onValueChange={v => set("currency")(v as Currency)}
              >
                <SelectTrigger
                  size="sm"
                  className="w-[5.5rem] shrink-0"
                  aria-label="Currency"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="KWD">KWD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </FormField>

          <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium">What this is</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name={id("kind")}
                  checked={draft.kind === "payment"}
                  onChange={() => set("kind")("payment")}
                />
                Payment received
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name={id("kind")}
                  checked={draft.kind === "refund"}
                  onChange={() => set("kind")("refund")}
                />
                Refund given back
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              A refund comes off cash on its day and counts among refunds, with
              the Whop refunds.
            </p>
          </fieldset>

          <FormField
            id={id("rail")}
            label="How it arrived"
            error={
              shown.rail ??
              (draft.rail === "tap" && info?.tapLive ? errors.rail : undefined)
            }
            hint={
              draft.rail === "tap"
                ? "Tap is not connected, so this counts on the Manual rail. Once Tap shows the same charge it drops out by itself."
                : "Whop payments are read by themselves, so never log them here."
            }
          >
            <Select
              value={draft.rail}
              onValueChange={v => set("rail")(v as ManualRail)}
            >
              <SelectTrigger
                id={id("rail")}
                size="sm"
                aria-invalid={Boolean(shown.rail)}
                aria-describedby={describe("rail")}
              >
                <SelectValue placeholder="Pick one" />
              </SelectTrigger>
              <SelectContent>
                {RAILS.map(r => (
                  <SelectItem key={r} value={r}>
                    {RAIL_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField
            id={id("client")}
            label="Client"
            error={shown.client}
            hint={
              draft.client.trim()
                ? card
                  ? `Matched to the ClickUp card "${card.name}".`
                  : options === undefined
                    ? "Loading the client list."
                    : "No ClickUp card has this exact name, so it is logged by name only and the renewal rule cannot tie it to a client."
                : "Pick from the list so the payment is tied to the client card."
            }
          >
            <Input
              id={id("client")}
              list={id("clients")}
              autoComplete="off"
              placeholder="Start typing a client"
              value={draft.client}
              onChange={e => set("client")(e.target.value)}
              aria-invalid={Boolean(shown.client)}
              aria-describedby={describe("client")}
            />
            <datalist id={id("clients")}>
              {(options ?? []).map(o => (
                <option key={o.clickupTaskId} value={o.name} />
              ))}
            </datalist>
          </FormField>

          <FormField
            id={id("deal")}
            label={`New deal value, ${draft.currency} (optional)`}
            error={shown.deal}
            hint={
              dealLow
                ? "This is below the payment. Check it is the full contract value."
                : "Only for a new deal signed with this payment and not on the closer form. It adds to contracted, never to cash."
            }
            className="xl:col-span-2"
          >
            <Input
              id={id("deal")}
              inputMode="decimal"
              autoComplete="off"
              placeholder="Leave empty if the closer form has the deal"
              value={draft.deal}
              onChange={e => set("deal")(e.target.value)}
              aria-invalid={Boolean(shown.deal)}
              aria-describedby={describe("deal")}
            />
            {draft.deal.trim() ? <FormDeals deals={formDeals} /> : null}
          </FormField>

          <FormField
            id={id("note")}
            label="Note (optional)"
            error={shown.note}
            className="sm:col-span-2 xl:col-span-2"
          >
            <Input
              id={id("note")}
              autoComplete="off"
              maxLength={500}
              placeholder="Reference, instalment, anything worth keeping"
              value={draft.note}
              onChange={e => set("note")(e.target.value)}
              aria-invalid={Boolean(shown.note)}
              aria-describedby={describe("note")}
            />
          </FormField>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" size="sm" disabled={pending}>
            <HandCoins aria-hidden />
            Review and log
          </Button>
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
            You confirm before anything is saved. There is no edit: a wrong
            entry is removed and logged again, and both steps are kept in the
            history.
          </p>
        </div>
      </form>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={open => {
          if (!open && !pending) {
            setConfirm(null);
            setProblem(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "refund"
                ? "Log this refund?"
                : "Log this payment?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              It adds to cash collected on the Manual rail
              {confirm?.deal !== null && confirm?.deal !== undefined
                ? ", and the deal value adds to contracted"
                : ""}
              . Check each line: a wrong entry can only be removed and logged
              again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirm ? (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
              <Fact label="Received">{date(confirm.day)}</Fact>
              <Fact label="From">
                {confirm.clientName}
                <span className="block text-xs text-muted-foreground">
                  {confirm.card
                    ? "Tied to its ClickUp card"
                    : "Not tied to a ClickUp card"}
                </span>
              </Fact>
              <Fact label="Amount">
                <span className="tabular-nums">
                  {amountWords(confirm.amount, confirm.currency, confirm.usd)}
                </span>
              </Fact>
              <Fact label="Arrived by">{RAIL_LABEL[confirm.rail]}</Fact>
              <Fact label="New deal">
                {confirm.deal === null ? (
                  "None"
                ) : (
                  <span className="tabular-nums">
                    {amountWords(
                      confirm.deal,
                      confirm.currency,
                      confirm.dealUsd,
                    )}
                  </span>
                )}
              </Fact>
              {confirm.note ? <Fact label="Note">{confirm.note}</Fact> : null}
            </dl>
          ) : null}
          {confirm && confirm.deal !== null ? (
            <FormDeals deals={formDealsIn(recentDeals, confirm.day)} />
          ) : null}
          {confirm?.rail === "tap" ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Tap is not connected, so this counts on the Manual rail for now.
              Once Tap is connected and shows the same charge, at most 3 days
              apart and within 5%, it drops out by itself so the money is
              counted once.
            </p>
          ) : null}
          {problem ? <Problem>{problem.message}</Problem> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              onClick={() => send(problem?.code === "repeat")}
              disabled={pending}
            >
              {pending
                ? "Logging..."
                : problem?.code === "repeat"
                  ? "Log it anyway"
                  : "Log payment"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}

// --- Remove and restore ---

type EntryRef = {
  id: string;
  client: string;
  day: string;
  usd: number;
  removed: boolean;
};

function EntryDialog({
  entry,
  onClose,
}: {
  entry: EntryRef | null;
  onClose: () => void;
}) {
  const remove = useMutation(api.ceo.manualPayments.softDelete);
  const restore = useMutation(api.ceo.manualPayments.restore);
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ManualPaymentRefusal | null>(null);
  const removing = entry !== null && !entry.removed;
  const repeat = !removing && problem?.code === "repeat";

  const close = () => {
    if (pending) return;
    setReason("");
    setProblem(null);
    onClose();
  };

  const run = async () => {
    if (!entry || pending) return;
    setPending(true);
    try {
      const id = entry.id as Id<"ceoManualPayments">;
      if (removing) {
        const why = reason.trim();
        await remove(why ? { id, reason: why } : { id });
        toast.success("Removed. Totals update in about a minute.");
      } else {
        await restore(repeat ? { id, allowRepeat: true } : { id });
        toast.success("Restored. Totals update in about a minute.");
      }
      setReason("");
      setProblem(null);
      onClose();
    } catch (e) {
      setProblem(refusal(e));
    } finally {
      setPending(false);
    }
  };

  const what = entry
    ? `${money(entry.usd)} from ${entry.client}, received ${date(entry.day)}`
    : "";

  return (
    <AlertDialog open={entry !== null} onOpenChange={open => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {removing ? "Remove this payment?" : "Restore this payment?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {removing
              ? `${what}. It leaves every total and stays in the list marked removed, so it can be restored. To correct an entry, remove it and log it again.`
              : `${what}. It goes back into the totals. If you already logged a corrected entry in its place, restoring this one counts the money twice.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {removing ? (
          <div className="grid gap-1.5">
            <Label htmlFor={reasonId} className="text-xs text-muted-foreground">
              Why (optional, kept in the history)
            </Label>
            <Input
              id={reasonId}
              autoComplete="off"
              maxLength={300}
              placeholder="Already on Whop, wrong amount, logged twice"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </div>
        ) : null}
        {problem ? <Problem>{problem.message}</Problem> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            variant={removing ? "destructive" : "default"}
            onClick={run}
            disabled={pending}
          >
            {pending
              ? removing
                ? "Removing..."
                : "Restoring..."
              : removing
                ? "Remove payment"
                : repeat
                  ? "Restore it anyway"
                  : "Restore payment"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- This month's entries ---

type Status = { tone: StatusTone; label: string; hint: string };

function entryStatus(
  row: ListRow,
  flag: ManualPaymentRow | undefined,
  kinds: Set<PossibleDuplicate["against"]> | undefined,
  computed: boolean,
  tapConnected: boolean,
  now: number,
): Status {
  if (row.deletedAt !== null)
    return {
      tone: "neutral",
      label: "Removed",
      hint: `Removed by ${row.deletedBy ?? "unknown"}, ${dateTime(row.deletedAt, now)}. It counts in no total.`,
    };
  if (!computed)
    return {
      tone: "good",
      label: "Live",
      hint: "In the totals of its month. The Tap and duplicate checks are shown for the current month only.",
    };
  if (!flag || flag.deletedAt !== null)
    return {
      tone: "neutral",
      label: "Updating",
      hint: "Changed after the last money refresh. The totals and checks pick it up within a minute or two.",
    };
  if (flag.coveredByTap)
    return {
      tone: "good",
      label: "On Tap now",
      hint: `Tap shows a matching charge of ${money(flag.coveredByTap.chargeUsd)} on ${date(flag.coveredByTap.chargeDay)}, so this entry is left out of every total and the money counts once, on the Tap rail.`,
    };
  if (flag.possibleDuplicate && (kinds?.has("whop") || kinds?.has("tap")))
    return {
      tone: "warning",
      label: "Possible duplicate",
      hint: `${kinds.has("whop") && kinds.has("tap") ? "Whop and Tap" : kinds.has("whop") ? "Whop" : "Tap"} may already count this money. It stays in the totals until removed. See Possible duplicates.`,
    };
  if (flag.possibleDuplicate)
    return {
      tone: "warning",
      label: "Deal already on form",
      hint: "The deal value matches a closer form deal for this client, so it is left out of contracted. The cash still counts. See Possible duplicates.",
    };
  if (row.rail === "tap" && !tapConnected)
    return {
      tone: "good",
      label: "Counted until Tap",
      hint: "Tap is not connected, so this counts on the Manual rail. Once Tap shows the same charge it drops out by itself.",
    };
  return {
    tone: "good",
    label: "Counted",
    hint: "In cash collected on the Manual rail.",
  };
}

export function ManualEntriesCard({
  section,
  payload,
  today,
  now,
  notes,
  order,
}: {
  section: CeoSection<"money"> | null;
  payload: MoneyPayload | null;
  today: string;
  now: number;
  notes: Note[] | undefined;
  order: number;
}) {
  const current = payload?.month ?? today.slice(0, 7);
  const [picked, setPicked] = useState<string | null>(null);
  const shownMonth = picked ?? current;
  const rows = useQuery(api.ceo.manualPayments.list, { month: shownMonth });
  const [open, setOpen] = useState<EntryRef | null>(null);

  const months = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < 12; i++) {
      const m = shiftMonth(current, -i);
      if (m) out.push(m);
    }
    return out;
  }, [current]);

  const computed = payload !== null && shownMonth === payload.month;
  const flags = useMemo(
    () => new Map((payload?.manualEntries ?? []).map(r => [r.id, r])),
    [payload],
  );
  const kinds = useMemo(() => {
    const out = new Map<string, Set<PossibleDuplicate["against"]>>();
    for (const d of payload?.possibleDuplicates ?? []) {
      const set = out.get(d.manualId) ?? new Set();
      set.add(d.against);
      out.set(d.manualId, set);
    }
    return out;
  }, [payload]);
  const tapConnected = payload?.rails?.tap.connected ?? false;
  const hasFlags = payload?.manualEntries !== undefined;

  const columns = useMemo<Column<ListRow>[]>(
    () => [
      {
        key: "day",
        header: "Received",
        cell: r => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {date(r.day)}
          </span>
        ),
        sortValue: r => r.day,
      },
      {
        key: "client",
        header: "Client",
        cell: r => (
          <div className="min-w-0">
            <span
              className="block max-w-[10rem] truncate font-medium text-foreground sm:max-w-[16rem]"
              title={r.client}
            >
              {r.client}
            </span>
            <span className="block max-w-[10rem] truncate text-xs text-muted-foreground sm:max-w-[16rem]">
              {RAIL_LABEL[r.rail]}
              {r.clickupTaskId ? "" : ", no client card"}
              {r.note ? `, ${r.note}` : ""}
            </span>
          </div>
        ),
        sortValue: r => r.client,
      },
      {
        key: "amount",
        header: "Amount",
        cell: r => (
          <div className={cn(r.deletedAt !== null && "line-through")}>
            {money(r.amountUsd)}
            {r.currency !== "USD" ? (
              <span className="block text-xs text-muted-foreground">
                {typed(r.amount, r.currency)}
              </span>
            ) : null}
          </div>
        ),
        sortValue: r => r.amountUsd,
        numeric: true,
      },
      {
        key: "deal",
        header: "New deal",
        cell: r =>
          r.dealContractedUsd === null ? (
            <span className="text-muted-foreground">None</span>
          ) : (
            money(r.dealContractedUsd)
          ),
        sortValue: r => r.dealContractedUsd,
        numeric: true,
        hideBelow: "md",
      },
      {
        key: "added",
        header: "Logged",
        cell: r => (
          <div className="min-w-0 whitespace-nowrap">
            {r.addedBy}
            <span className="block text-xs tabular-nums text-muted-foreground">
              {dateTime(r.addedAt, now)}
            </span>
          </div>
        ),
        sortValue: r => r.addedAt,
        hideBelow: "sm",
      },
      {
        key: "status",
        header: "Status",
        cell: r => {
          const s = entryStatus(
            r,
            flags.get(r.id),
            kinds.get(r.id),
            computed && hasFlags,
            tapConnected,
            now,
          );
          return <StatusChip tone={s.tone} label={s.label} hint={s.hint} />;
        },
        hideBelow: "sm",
      },
      {
        key: "action",
        header: "",
        cell: r => {
          const removed = r.deletedAt !== null;
          const ref: EntryRef = {
            id: r.id,
            client: r.client,
            day: r.day,
            usd: r.amountUsd,
            removed,
          };
          return (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOpen(ref)}
              aria-label={`${removed ? "Restore" : "Remove"} ${money(r.amountUsd)} from ${r.client}`}
            >
              {removed ? <RotateCcw aria-hidden /> : <Trash2 aria-hidden />}
              <span className="hidden sm:inline">
                {removed ? "Restore" : "Remove"}
              </span>
            </Button>
          );
        },
        className: "w-px",
      },
    ],
    [computed, flags, hasFlags, kinds, now, tapConnected],
  );

  const live = (rows ?? []).filter(r => r.deletedAt === null);
  const removedCount = (rows ?? []).length - live.length;
  const monthRow = payload?.monthly.find(m => m.month === shownMonth);
  const railFigure = computed
    ? payload?.rails?.manual?.connected
      ? payload.rails.manual.mtd
      : null
    : (monthRow?.manualCash ?? null);

  return (
    <SectionCard
      kicker={month(shownMonth, { long: true, year: true })}
      title="Logged by hand"
      alsoReads={[section]}
      notes={notes}
      order={order}
      actions={
        <Select value={shownMonth} onValueChange={v => setPicked(v)}>
          <SelectTrigger size="sm" className="w-[9.5rem]" aria-label="Month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map(m => (
              <SelectItem key={m} value={m}>
                {month(m, { long: true, year: true })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {rows === undefined ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          Loading the entries.
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title={`Nothing logged by hand for ${month(shownMonth, { long: true })}`}
          text="A transfer, cheque or cash payment nobody logged is missing from cash, not zero. Log it above."
          compact
        />
      ) : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            <StatTile
              variant="plain"
              label="Live entries"
              value={count(live.length)}
              sub={`${money(live.reduce((t, r) => t + r.amountUsd, 0))} as logged`}
            />
            <StatTile
              variant="plain"
              label="Counted on the Manual rail"
              value={money(railFigure)}
              sub={
                computed
                  ? "As of the last money refresh"
                  : "For the month, as of the last money refresh"
              }
              hint="Live entries, less any that Tap now shows as its own charge."
              naHint={
                payload === null
                  ? "The money section has not been computed yet."
                  : "The last money refresh did not include this figure yet."
              }
            />
            <StatTile
              variant="plain"
              label="Removed"
              value={count(removedCount)}
              sub={
                removedCount
                  ? "Kept in the list, in no total"
                  : "Nothing removed this month"
              }
            />
          </div>
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={r => r.id}
            caption={`Payments logged by hand for ${month(shownMonth, { long: true, year: true })}`}
            emptyText="Nothing logged by hand for this month."
          />
        </div>
      )}
      <EntryDialog entry={open} onClose={() => setOpen(null)} />
    </SectionCard>
  );
}

// --- Possible duplicates ---

const AGAINST: Record<PossibleDuplicate["against"], string> = {
  whop: "Whop payment",
  tap: "Tap charge",
  closer_form: "Closer form deal",
};

const LIKE: Record<PossibleDuplicate["against"], string> = {
  whop: "Like a Whop payment",
  tap: "Like a Tap charge",
  closer_form: "Like a closer form deal",
};

function gapWords(d: PossibleDuplicate): string {
  const days =
    d.daysApart === 0 ? "Same day" : `${plural(d.daysApart, "day")} apart`;
  // Under 0.05% reads as 0% and is the same money to the cent or so.
  const amounts =
    isNum(d.amountGap) && d.amountGap >= 0.0005
      ? `amounts ${pct(d.amountGap)} apart`
      : "same amount";
  return `${days}, ${amounts}`;
}

export function DuplicatesCard({
  section,
  notes,
  order,
}: {
  section: CeoSection<"money"> | null;
  notes: Note[] | undefined;
  order: number;
}) {
  const [open, setOpen] = useState<EntryRef | null>(null);
  return (
    <SectionCard
      kicker="Hand entries of the last 90 days, hand-logged deals of the last 12 months"
      title="Possible duplicates"
      section={section}
      notes={notes}
      order={order}
    >
      {p => (
        <>
          <DuplicateList p={p} onRemove={setOpen} />
          <EntryDialog entry={open} onClose={() => setOpen(null)} />
        </>
      )}
    </SectionCard>
  );
}

function DuplicateList({
  p,
  onRemove,
}: {
  p: MoneyPayload;
  onRemove: (e: EntryRef) => void;
}) {
  const list = p.possibleDuplicates;
  if (list === undefined)
    return (
      <EmptyState
        icon={CopyCheck}
        title="Not checked yet"
        text="The check fills in at the next money refresh."
        compact
      />
    );
  if (list.length === 0)
    return (
      <EmptyState
        icon={CopyCheck}
        title="Nothing logged by hand looks counted twice"
        text="Each entry is checked against Whop and Tap payments at most 3 days apart and within 5%, and each hand-logged deal value against closer form deals for the same client."
        compact
      />
    );
  const cash = list.filter(d => d.against !== "closer_form");
  return (
    <div className="grid gap-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        {plural(list.length, "possible duplicate")}.{" "}
        {cash.length
          ? `${plural(cash.length, "cash entry stays", "cash entries stay")} in every total until removed.`
          : ""}{" "}
        Nothing here is removed by itself.
      </p>
      <ul className="divide-y border-y">
        {list.map(d => (
          <li
            key={`${d.manualId}-${d.against}`}
            className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate font-medium text-foreground">
                  {d.manualClient}
                </span>
                <StatusChip tone="warning" label={LIKE[d.against]} />
              </div>
              <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs tabular-nums">
                <dt className="text-muted-foreground">
                  {d.against === "closer_form"
                    ? "Deal logged by hand"
                    : "Logged by hand"}
                </dt>
                <dd className="text-foreground">
                  {money(d.manualUsd)} on {date(d.manualDay)}
                </dd>
                <dt className="text-muted-foreground">{AGAINST[d.against]}</dt>
                <dd className="text-foreground">
                  {money(d.otherUsd)} on {date(d.otherDay)}
                  {d.otherClient ? `, ${d.otherClient}` : ", no client name"}
                </dd>
                <dt className="text-muted-foreground">Gap</dt>
                <dd className="text-foreground">{gapWords(d)}</dd>
              </dl>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {d.why}
              </p>
            </div>
            <div className="sm:pt-0.5">
              {d.against === "closer_form" ? (
                <span className="text-xs text-muted-foreground">
                  Already left out of contracted
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onRemove({
                      id: d.manualId,
                      client: d.manualClient,
                      day: d.manualDay,
                      usd: d.manualUsd,
                      removed: false,
                    })
                  }
                >
                  <Trash2 aria-hidden />
                  Remove hand entry
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
