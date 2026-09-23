import {
  ArrowUpRight,
  ChevronDown,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  Account,
  Edit,
  EventRow,
  Ladder,
  Sheet,
  SheetRow,
} from "../../../convex/billingCore";
import { ladderOf, METHODS, PLANS } from "../../../convex/billingCore";

/**
 * The client billing sheet. The same file in the CEO cockpit and the client
 * success cockpit (scripts/check-shared.sh holds it to that), wired to each
 * app's own actions through `api`, so both screens show the same clients,
 * the same ladder and the same decisions.
 *
 * Aziz, 2026-09-23: "a sheet where we can see all the clients and where
 * they're at with billing, and make decisions on it... in one very clean way,
 * without it being too busy... really good-looking and makes billing
 * extremely easy."
 *
 * One idea carries the screen: every client's next payment sits on the same
 * short strip of days around today, so reading down the column shows the
 * book's fortnight at once. Late ones sit left of the line, the ones due soon
 * just right of it. Everything else is quiet on purpose. A row opens in
 * place, under itself, so a decision is made next to the numbers it is about,
 * and the row stays open and in view after the decision even when it no
 * longer matches the filter.
 */

type Ltv = { target: number; baseline: number; logged: number };

export type BillingPayload = Sheet & {
  ltv?: Record<string, Ltv | undefined>;
  lastPaid?: Record<
    string,
    { day: string; usd: number; rail: string } | undefined
  >;
  unassigned?: {
    payer: string;
    count: number;
    usd: number;
    last: string;
    rails: string[];
  }[];
  moneyAsOf?: number | null;
};

export type Rail = "bank_transfer" | "cheque" | "cash" | "tap" | "other";

export type PaymentInput = {
  account: Account;
  day: string;
  amount: number;
  currency: "USD" | "KWD";
  rail: Rail;
  reference: string;
  evidenceUrl: string;
  note: string;
  nextDate: string | null;
  /** Log it even though the same payment is already logged that day. */
  allowRepeat?: boolean;
};

export type BillingApi = {
  sheet: (a: { fresh?: boolean }) => Promise<BillingPayload>;
  edit: (a: { taskId: string; edit: Edit }) => Promise<Account>;
  /** Returns the sentence to show once it is done. */
  logPayment: (p: PaymentInput) => Promise<string>;
  /** Only where the ledger is: tie a payer's money to a client. */
  assign?: (p: {
    payer: string;
    taskId: string;
    clientName: string;
    usd: number;
    count: number;
  }) => Promise<string>;
  /** What happens to a logged payment in this cockpit, in one line. */
  ledgerLine: string;
};

// --- look ------------------------------------------------------------------

// The CEO kit's status roles (components/ceo/ceo.css), redeclared here so the
// sheet looks the same in the client success cockpit, which has no CEO kit.
// Status colour goes on a dot or a mark, never on text.
const STYLE = `
.billing-root{--b-good:#0ca30c;--b-warning:#fab219;--b-serious:#ec835a;--b-critical:#d03b3b;--b-line:color-mix(in srgb,currentColor 14%,transparent);--b-today:color-mix(in srgb,currentColor 45%,transparent)}
`;

const TONE: Record<Ladder["tone"], string> = {
  neutral: "color-mix(in srgb, currentColor 30%, transparent)",
  good: "var(--b-good)",
  warning: "var(--b-warning)",
  serious: "var(--b-serious)",
  critical: "var(--b-critical)",
};

// Native selects, styled as the kit's Input, so a phone gets its own picker.
const select =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm";
const label = "text-xs font-medium text-muted-foreground";
const chip = (on: boolean) =>
  `rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? "border-transparent bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`;

const usd = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : `$${v.toLocaleString("en-US", { maximumFractionDigits: v % 1 ? 2 : 0 })}`;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const shortDay = (d: string | null | undefined) => {
  if (!d) return "—";
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m - 1]}`;
};

function when(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days late`;
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** The same day next month, or the month's last day when it has fewer. */
function addMonth(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

const RAIL: Record<string, string> = {
  bank_transfer: "bank transfer",
  cheque: "cheque",
  cash: "cash",
  tap: "Tap",
  other: "another way",
  whop: "Whop",
  bank: "the bank statement",
  manual: "logged by hand",
};

/** What a refused call says, in the words the server wrote. */
function errorText(e: unknown): string {
  const data = (e as { data?: unknown } | null)?.data;
  if (typeof data === "string") return data;
  if (data && typeof (data as { message?: unknown }).message === "string")
    return (data as { message: string }).message;
  const raw = e instanceof Error ? e.message : String(e);
  const m = raw.match(/Uncaught Error: ([\s\S]*?)(?:\n\s+at |$)/);
  return (
    (m ? m[1] : raw).trim().slice(0, 300) ||
    "That did not save, so nothing changed. Try again in a minute."
  );
}
const isRepeat = (e: unknown) =>
  (e as { data?: { code?: string } } | null)?.data?.code === "repeat";

// --- small parts -----------------------------------------------------------

/** The signature: where this payment sits in the fortnight around today. */
function Strip({ days, tone }: { days: number | null; tone: Ladder["tone"] }) {
  const SPAN = 10;
  if (days === null) return <div className="h-2.5" aria-hidden />;
  const at = Math.max(-SPAN, Math.min(SPAN, days));
  const beyond = Math.abs(days) > SPAN;
  return (
    <div className="relative h-2.5" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--b-line)]" />
      <div className="absolute left-1/2 top-0 h-full w-px bg-[var(--b-today)]" />
      <div
        className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          left: `${((at + SPAN) / (SPAN * 2)) * 100}%`,
          background: TONE[tone],
          // Past the edge of the strip: a ring says "further than this".
          boxShadow: beyond
            ? `0 0 0 3px color-mix(in srgb, ${TONE[tone]} 22%, transparent)`
            : undefined,
        }}
      />
    </div>
  );
}

function Dot({ tone }: { tone: Ladder["tone"] }) {
  return (
    <span
      className="inline-block size-1.5 shrink-0 rounded-full"
      style={{ background: TONE[tone] }}
      aria-hidden
    />
  );
}

function Step({ ladder }: { ladder: Ladder }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5 text-sm">
      <span className="relative -top-px">
        <Dot tone={ladder.tone} />
      </span>
      <span
        className={`line-clamp-2 ${ladder.tone === "neutral" ? "text-muted-foreground" : ""}`}
      >
        {ladder.label}
      </span>
    </span>
  );
}

function Figure({
  title,
  value,
  sub,
  tone,
}: {
  title: string;
  value: string;
  sub: string;
  tone?: Ladder["tone"];
}) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {tone ? <Dot tone={tone} /> : null}
        {title}
      </span>
      <span className="text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  );
}

/** A labelled control: the label points at the control by id. */
function Field({
  label: text,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={`grid content-start gap-1 ${className ?? ""}`}>
      <label htmlFor={id} className={label}>
        {text}
      </label>
      {children(id)}
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

// --- filters ---------------------------------------------------------------

const NOW_RUNGS = new Set([
  "churn",
  "pause",
  "call",
  "day1",
  "today",
  "invoice",
  "confirm",
  "day14",
  "day7",
]);
type Filter = "now" | "all" | "late" | "paused" | "extended" | "nomethod";
const FILTERS: {
  key: Filter;
  label: string;
  test: (r: SheetRow) => boolean;
}[] = [
  {
    key: "now",
    label: "Needs you now",
    test: r =>
      NOW_RUNGS.has(r.ladder.rung) ||
      (r.group === "paused" && !r.pausedOn) ||
      (r.group === "active" && !r.nextDate),
  },
  { key: "all", label: "Everyone", test: () => true },
  {
    key: "late",
    label: "Late",
    test: r =>
      r.ladder.days !== null && r.ladder.days < 0 && r.group !== "paused",
  },
  { key: "paused", label: "Paused", test: r => r.group === "paused" },
  {
    key: "extended",
    label: "On an extension",
    test: r => (r.extensionWeeks ?? 0) > 0,
  },
  {
    key: "nomethod",
    label: "No payment method",
    test: r => r.group === "active" && !r.method,
  },
];

// --- one client, opened ----------------------------------------------------

type Tab = "pay" | "date" | "extend" | "pause" | "method" | "note";

function Panel({
  row,
  api,
  events,
  today,
  ltv,
  lastPaid,
  notice,
  onDone,
}: {
  row: SheetRow;
  api: BillingApi;
  events: (EventRow & { id: number; at: string })[];
  today: string;
  ltv?: Ltv;
  lastPaid?: { day: string; usd: number; rail: string };
  notice: string | null;
  onDone: (message: string, updated?: Account) => void;
}) {
  const paused = row.group === "paused";
  const [tab, setTab] = useState<Tab>(paused ? "pause" : "pay");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repeat, setRepeat] = useState(false);

  // A payment
  const [day, setDay] = useState(today);
  const [amount, setAmount] = useState(row.nextUsd ? String(row.nextUsd) : "");
  const [currency, setCurrency] = useState<"USD" | "KWD">("USD");
  const [rail, setRail] = useState<Rail>("bank_transfer");
  const [reference, setReference] = useState("");
  const [evidence, setEvidence] = useState("");
  const [payNote, setPayNote] = useState("");
  const recurring = /monthly|split|months after|performance/i.test(
    row.plan ?? "",
  );
  // Offer next month only when this payment is for the date on the card
  // (due within a week, or late). A date already moved on, as Liwan's was on
  // 23 Sep, would otherwise be pushed a month further.
  const forThisDate = Boolean(
    row.nextDate && row.nextDate <= addDays(today, 7),
  );
  const [rollTo, setRollTo] = useState(
    row.nextDate && recurring && forThisDate ? addMonth(row.nextDate) : "",
  );
  // The date, an extension, a pause
  const [date, setDate] = useState(row.nextDate ?? today);
  const [why, setWhy] = useState("");
  const [weeks, setWeeks] = useState(2);
  const [ours, setOurs] = useState(false);
  const [moveDate, setMoveDate] = useState(true);
  // How they pay
  const [method, setMethod] = useState(row.method ?? "");
  const [plan, setPlan] = useState(row.plan ?? "");
  const [nextAmount, setNextAmount] = useState(
    row.nextUsd ? String(row.nextUsd) : "",
  );
  const [note, setNote] = useState("");

  const run = async (
    fn: () => Promise<{ message: string; updated?: Account }>,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const out = await fn();
      setRepeat(false);
      onDone(out.message, out.updated);
    } catch (e) {
      setRepeat(isRepeat(e));
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const edit = (e: Edit, message: string) =>
    run(async () => ({
      message,
      updated: await api.edit({ taskId: row.taskId, edit: e }),
    }));
  const pay = (allowRepeat: boolean) =>
    run(async () => ({
      message: await api.logPayment({
        account: row,
        day,
        amount: Number(amount),
        currency,
        rail,
        reference: reference.trim(),
        evidenceUrl: evidence.trim(),
        note: payNote.trim(),
        nextDate: rollTo || null,
        ...(allowRepeat ? { allowRepeat: true } : {}),
      }),
    }));

  const extendedTo = addDays(
    row.nextDate && row.nextDate > today ? row.nextDate : today,
    weeks * 7,
  );
  const mine = events.filter(e => e.clickup_task_id === row.taskId).slice(0, 8);
  const first = row.name.split(/\s+/)[0];

  const TABS: { key: Tab; label: string; show: boolean }[] = [
    { key: "pay", label: "Log a payment", show: true },
    { key: "date", label: "Move the date", show: !paused },
    { key: "extend", label: "Extend", show: !paused },
    { key: "pause", label: paused ? "Resume" : "Pause", show: true },
    { key: "method", label: "How they pay", show: true },
    { key: "note", label: "Note", show: true },
  ];

  return (
    <div className="grid gap-5 border-t bg-muted/30 px-3 py-4 sm:px-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-8">
      <div className="grid min-w-0 content-start gap-4">
        <div
          className="flex flex-wrap gap-1"
          role="tablist"
          aria-label={`What to do for ${row.name}`}
        >
          {TABS.filter(t => t.show).map(t => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => {
                setTab(t.key);
                setError(null);
                setRepeat(false);
              }}
              className={chip(tab === t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "pay" ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Received on">
                {id => (
                  <>
                    <DateInput
                      id={id}
                      max={today}
                      value={day}
                      onChange={e => setDay(e.target.value)}
                    />
                  </>
                )}
              </Field>
              <Field label="Amount">
                {id => (
                  <>
                    <Input
                      id={id}
                      inputMode="decimal"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                    />
                  </>
                )}
              </Field>
              <Field label="Currency">
                {id => (
                  <>
                    <AnimatedSelect
                      id={id}
                      className={select}
                      value={currency}
                      onChange={e =>
                        setCurrency(e.target.value as "USD" | "KWD")
                      }
                    >
                      <option value="USD">USD</option>
                      <option value="KWD">KWD</option>
                    </AnimatedSelect>
                  </>
                )}
              </Field>
              <Field label="How it came">
                {id => (
                  <>
                    <AnimatedSelect
                      id={id}
                      className={select}
                      value={rail}
                      onChange={e => setRail(e.target.value as Rail)}
                    >
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="cheque">Cheque</option>
                      <option value="cash">Cash</option>
                      <option value="tap">Tap</option>
                      <option value="other">Another way</option>
                    </AnimatedSelect>
                  </>
                )}
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Receipt or transfer photo">
                {id => (
                  <>
                    <Input
                      id={id}
                      value={evidence}
                      onChange={e => setEvidence(e.target.value)}
                      placeholder="A link to the photo"
                    />
                  </>
                )}
              </Field>
              <Field label="Reference">
                {id => (
                  <>
                    <Input
                      id={id}
                      value={reference}
                      onChange={e => setReference(e.target.value)}
                      placeholder="Invoice or transfer number"
                    />
                  </>
                )}
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Their next payment">
                {id => (
                  <>
                    <DateInput
                      id={id}
                      value={rollTo}
                      onChange={e => setRollTo(e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground">
                      {rollTo
                        ? `The card moves to ${shortDay(rollTo)}.`
                        : "Empty keeps the card's date as it is."}
                    </span>
                  </>
                )}
              </Field>
              <Field label="Note">
                {id => (
                  <>
                    <Input
                      id={id}
                      value={payNote}
                      onChange={e => setPayNote(e.target.value)}
                      placeholder="Anything the ledger should say"
                    />
                  </>
                )}
              </Field>
            </div>
            {rail === "bank_transfer" && !evidence.trim() ? (
              <p className="flex items-start gap-2 text-xs">
                <span className="mt-1">
                  <Dot tone="warning" />
                </span>
                A bank transfer without its receipt photo counts as unpaid. Log
                it once you have the photo.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Card and Whop payments arrive by themselves; typing one here would
              count it twice. {api.ledgerLine}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy || !(Number(amount) > 0) || !day}
                onClick={() => pay(false)}
              >
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Log the payment
              </Button>
              {repeat ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => pay(true)}
                >
                  It is a second payment: log it too
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "date" ? (
          <div className="grid gap-3 sm:max-w-md">
            <Field label="Next payment date">
              {id => (
                <>
                  <DateInput
                    id={id}
                    value={date}
                    onChange={e => setDate(e.target.value)}
                  />
                </>
              )}
            </Field>
            <Field label="Why it moved">
              {id => (
                <>
                  <Input
                    id={id}
                    value={why}
                    onChange={e => setWhy(e.target.value)}
                    placeholder="Agreed on Monday's call"
                  />
                </>
              )}
            </Field>
            <div>
              <Button
                size="sm"
                disabled={busy || !date || date === row.nextDate}
                onClick={() =>
                  edit(
                    { kind: "date", value: date, reason: why.trim() },
                    `Moved ${row.name}'s payment to ${shortDay(date)}.`,
                  )
                }
              >
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Move it to {shortDay(date)}
              </Button>
            </div>
          </div>
        ) : null}

        {tab === "extend" ? (
          <div className="grid gap-3 sm:max-w-lg">
            <div className="flex gap-1" role="radiogroup" aria-label="How long">
              {[1, 2, 4].map(w => (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={weeks === w}
                  onClick={() => setWeeks(w)}
                  className={chip(weeks === w)}
                >
                  {plural(w, "week")}
                </button>
              ))}
            </div>
            <Field label="Why">
              {id => (
                <>
                  <Input
                    id={id}
                    value={why}
                    onChange={e => setWhy(e.target.value)}
                    placeholder="Their launch slipped; they asked on the call"
                  />
                </>
              )}
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={ours}
                onChange={e => setOurs(e.target.checked)}
              />
              It was ours to control
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={moveDate}
                onChange={e => setMoveDate(e.target.checked)}
              />
              Move their payment to {shortDay(extendedTo)}
            </label>
            <div>
              <Button
                size="sm"
                disabled={busy || why.trim().length < 4}
                onClick={() =>
                  edit(
                    { kind: "extension", weeks, reason: why, ours, moveDate },
                    `Extended ${row.name} by ${plural(weeks, "week")}${moveDate ? `; they pay on ${shortDay(extendedTo)}` : ""}.`,
                  )
                }
              >
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Extend by {plural(weeks, "week")}
              </Button>
            </div>
          </div>
        ) : null}

        {tab === "pause" ? (
          paused ? (
            <div className="grid gap-3 sm:max-w-md">
              <p className="text-sm text-muted-foreground">
                {row.pausedOn
                  ? `Paused since ${shortDay(row.pausedOn)}.`
                  : "Paused, with no pause date on the card."}{" "}
                Resuming sets them Active and clears the pause date, so a later
                pause is counted from its own day.
              </p>
              <Field label="Their next payment">
                {id => (
                  <>
                    <DateInput
                      id={id}
                      value={date}
                      onChange={e => setDate(e.target.value)}
                    />
                  </>
                )}
              </Field>
              <div>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    edit(
                      { kind: "resume", nextDate: date || undefined },
                      `Resumed ${row.name}${date ? `; they pay on ${shortDay(date)}` : ""}.`,
                    )
                  }
                >
                  {busy ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : null}
                  Resume {first}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:max-w-md">
              <p className="text-sm text-muted-foreground">
                The SOP pauses on the third day late, and only after a call.
                Fifteen days after the pause is churn.
              </p>
              <Field label="Why">
                {id => (
                  <>
                    <Input
                      id={id}
                      value={why}
                      onChange={e => setWhy(e.target.value)}
                      placeholder="Three days late; called twice, no answer"
                    />
                  </>
                )}
              </Field>
              <div>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy || why.trim().length < 4}
                  onClick={() =>
                    edit(
                      { kind: "pause", reason: why },
                      `Paused ${row.name} from today.`,
                    )
                  }
                >
                  {busy ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : null}
                  Pause {first}
                </Button>
              </div>
            </div>
          )
        ) : null}

        {tab === "method" ? (
          <div className="grid gap-3 sm:max-w-lg">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Payment method">
                {id => (
                  <>
                    <AnimatedSelect
                      id={id}
                      className={select}
                      value={method}
                      onChange={e => setMethod(e.target.value)}
                    >
                      <option value="">Not set</option>
                      {METHODS.map(m => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </AnimatedSelect>
                  </>
                )}
              </Field>
              <Field label="Plan">
                {id => (
                  <>
                    <AnimatedSelect
                      id={id}
                      className={select}
                      value={plan}
                      onChange={e => setPlan(e.target.value)}
                    >
                      <option value="">Not set</option>
                      {PLANS.map(p => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </AnimatedSelect>
                  </>
                )}
              </Field>
            </div>
            <Field label="Next payment, USD" className="sm:max-w-[12rem]">
              {id => (
                <>
                  <Input
                    id={id}
                    inputMode="decimal"
                    value={nextAmount}
                    onChange={e => setNextAmount(e.target.value)}
                  />
                </>
              )}
            </Field>
            <p className="text-xs text-muted-foreground">
              Card on file is the SOP's default: the one method where the money
              arrives on the day without anyone asking.
            </p>
            <div>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    let updated: Account | undefined;
                    const changed: string[] = [];
                    if (method && method !== row.method) {
                      updated = await api.edit({
                        taskId: row.taskId,
                        edit: { kind: "method", value: method },
                      });
                      changed.push(`pays by ${method.toLowerCase()}`);
                    }
                    if (plan && plan !== row.plan) {
                      updated = await api.edit({
                        taskId: row.taskId,
                        edit: { kind: "plan", value: plan },
                      });
                      changed.push(`is on ${plan}`);
                    }
                    const amt = Number(nextAmount);
                    if (nextAmount.trim() && amt > 0 && amt !== row.nextUsd) {
                      updated = await api.edit({
                        taskId: row.taskId,
                        edit: { kind: "amount", value: amt },
                      });
                      changed.push(`owes ${usd(amt)} next`);
                    }
                    return {
                      message: changed.length
                        ? `Saved: ${row.name} ${changed.join(", ")}.`
                        : "Nothing had changed, so nothing was saved.",
                      updated,
                    };
                  })
                }
              >
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Save
              </Button>
            </div>
          </div>
        ) : null}

        {tab === "note" ? (
          <div className="grid gap-3">
            <Field label="Note">
              {id => (
                <>
                  <Textarea
                    id={id}
                    className="min-h-[72px]"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="Pays on Sunday, after their own client's payment clears"
                  />
                </>
              )}
            </Field>
            <p className="text-xs text-muted-foreground">
              It goes on the ClickUp card as a comment and into the billing log.
            </p>
            <div>
              <Button
                size="sm"
                disabled={busy || note.trim().length < 2}
                onClick={() =>
                  edit(
                    { kind: "note", text: note },
                    "Added the note to the card.",
                  )
                }
              >
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Add the note
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : notice ? (
          <p className="text-sm" role="status">
            {notice}
          </p>
        ) : null}
      </div>

      <div className="grid min-w-0 content-start gap-4 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div className="min-w-0">
            <dt className={label}>Plan</dt>
            <dd className="truncate">{row.plan ?? "Not set"}</dd>
          </div>
          <div className="min-w-0">
            <dt className={label}>MRR on the card</dt>
            <dd className="tabular-nums">{usd(row.mrrUsd)}</dd>
          </div>
          <div className="min-w-0">
            <dt className={label}>LTV</dt>
            <dd className="tabular-nums">
              {ltv ? usd(ltv.target) : usd(row.ltvFieldUsd)}
            </dd>
            {ltv ? (
              <dd className="text-xs text-muted-foreground">
                {usd(ltv.baseline)} on 21 Sep, {usd(ltv.logged)} since
              </dd>
            ) : null}
          </div>
          <div className="min-w-0">
            <dt className={label}>Last payment tied</dt>
            <dd className="tabular-nums">
              {lastPaid
                ? `${usd(lastPaid.usd)}, ${shortDay(lastPaid.day)}`
                : "None yet"}
            </dd>
            {lastPaid ? (
              <dd className="text-xs text-muted-foreground">
                by {RAIL[lastPaid.rail] ?? lastPaid.rail}
              </dd>
            ) : null}
          </div>
          {row.pausedOn ? (
            <div className="min-w-0">
              <dt className={label}>Paused on</dt>
              <dd>{shortDay(row.pausedOn)}</dd>
            </div>
          ) : null}
          {row.extensionWeeks ? (
            <div className="min-w-0">
              <dt className={label}>Extension</dt>
              <dd>{plural(row.extensionWeeks, "week")}</dd>
            </div>
          ) : null}
          {row.csm ? (
            <div className="min-w-0">
              <dt className={label}>Success manager</dt>
              <dd className="truncate">{row.csm}</dd>
            </div>
          ) : null}
        </dl>

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">What happened</span>
            {row.url ? (
              <a
                href={row.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Open the ClickUp card
                <ArrowUpRight className="size-3" aria-hidden />
              </a>
            ) : null}
          </div>
          {mine.length ? (
            <ul className="grid gap-1.5">
              {mine.map(e => (
                <li key={e.id} className="text-xs leading-relaxed">
                  <span className="tabular-nums text-muted-foreground">
                    {shortDay(e.at.slice(0, 10))}:{" "}
                  </span>
                  {sentenceOf(e)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nothing logged for {row.name} yet. Every decision made here or by
              Maher shows up in this list.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function sentenceOf(e: EventRow): string {
  const who = e.source === "maher" ? "Maher" : String(e.by_whom).split("@")[0];
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const paid =
    d.currency === "KWD"
      ? `${Number(d.amount).toLocaleString("en-US")} KWD`
      : usd(Number(d.amount));
  switch (e.kind) {
    case "payment":
      return `${who} logged ${paid}${d.rail ? ` by ${RAIL[String(d.rail)] ?? d.rail}` : ""}${e.to_value && e.to_value !== e.from_value ? `; next due ${shortDay(e.to_value)}` : ""}.`;
    case "extension":
      return `${who} extended by ${plural(Number(d.weeks), "week")}${e.reason ? `: ${e.reason}` : "."}`;
    case "pause":
      return `${who} paused the account${e.reason ? `: ${e.reason}` : "."}`;
    case "resume":
      return `${who} resumed the account.`;
    case "date":
      return `${who} moved the payment to ${shortDay(e.to_value)}${e.reason ? `: ${e.reason}` : "."}`;
    case "method":
      return `${who} set the method to ${e.to_value}.`;
    case "plan":
      return `${who} set the plan to ${e.to_value}.`;
    case "amount":
      return `${who} set the next payment to ${usd(Number(e.to_value))}.`;
    case "assign":
      return e.reason ?? `${who} tied a payer to this client.`;
    case "note":
      return `${who}: ${e.reason}`;
    default:
      return `${who}: ${e.kind}${e.reason ? `, ${e.reason}` : ""}.`;
  }
}

// --- the sheet -------------------------------------------------------------

const COLS =
  "md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1.25fr)_minmax(0,0.75fr)_1rem]";

export function BillingSheet({ api }: { api: BillingApi }) {
  const [data, setData] = useState<BillingPayload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("now");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ taskId: string; text: string } | null>(
    null,
  );
  const [banner, setBanner] = useState<string | null>(null);

  const load = useCallback(
    async (fresh = false) => {
      setBusy(true);
      setError(null);
      try {
        setData(await api.sheet({ fresh }));
      } catch (e) {
        setError(errorText(e));
      } finally {
        setBusy(false);
      }
    },
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);

  /** Show a decision at once, then read the sheet again behind it. */
  const settle = (taskId: string, text: string, updated?: Account) => {
    setNotice({ taskId, text });
    if (updated)
      setData(d =>
        d
          ? {
              ...d,
              rows: d.rows.map(r =>
                r.taskId === updated.taskId
                  ? { ...updated, ladder: ladderOf(updated, d.today) }
                  : r,
              ),
            }
          : d,
      );
    void load();
  };

  const rows = useMemo(() => {
    if (!data) return [];
    const f = FILTERS.find(x => x.key === filter) ?? FILTERS[0];
    const q = query.trim().toLowerCase();
    return data.rows.filter(
      r =>
        // The open row stays, so a decision never makes it vanish mid-read.
        (r.taskId === open || f.test(r)) &&
        (!q || r.name.toLowerCase().includes(q)),
    );
  }, [data, filter, query, open]);

  const counts = useMemo(() => {
    const out = {} as Record<Filter, number>;
    for (const f of FILTERS)
      out[f.key] = data ? data.rows.filter(f.test).length : 0;
    return out;
  }, [data]);

  if (!data)
    return (
      <div className="billing-root rounded-xl border bg-card p-6">
        <style>{STYLE}</style>
        {error ? (
          <div className="grid gap-3">
            <p className="text-sm text-destructive">{error}</p>
            <div>
              <Button size="sm" variant="outline" onClick={() => load()}>
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Reading the billing sheet
          </p>
        )}
      </div>
    );

  const t = data.totals;
  const read = data.syncedAt
    ? new Date(data.syncedAt).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kuwait",
      })
    : null;

  return (
    <div className="billing-root grid gap-4">
      <style>{STYLE}</style>

      <section className="rounded-xl border bg-card p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
            <Figure
              title="Due in 7 days"
              value={usd(t.dueThisWeek.usd)}
              sub={plural(t.dueThisWeek.count, "client")}
            />
            <Figure
              title="Late"
              value={usd(t.overdue.usd)}
              sub={
                t.overdue.count
                  ? plural(t.overdue.count, "client")
                  : "nobody is late"
              }
              tone={t.overdue.count ? "critical" : undefined}
            />
            <Figure
              title="Paused"
              value={String(t.paused)}
              sub={
                t.extended
                  ? `${t.extended} more on an extension`
                  : "no extensions running"
              }
              tone={t.paused ? "warning" : undefined}
            />
            <Figure
              title="No method set"
              value={String(t.noMethod)}
              sub={
                t.noDate
                  ? `active; ${t.noDate} with no payment date`
                  : "active clients"
              }
              tone={t.noMethod ? "warning" : undefined}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={busy}
            onClick={() => load(true)}
            aria-label="Read every card from ClickUp again"
          >
            <RefreshCw className={busy ? "animate-spin" : ""} aria-hidden />
            <span className="hidden sm:inline">
              {busy ? "Reading ClickUp" : "Read ClickUp again"}
            </span>
          </Button>
        </div>

        {banner ? (
          <p className="mt-3 text-sm" role="status">
            {banner}
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b p-3 sm:px-4">
          {/* One row that scrolls sideways on a phone; an empty view is not offered. */}
          <div className="-mx-3 flex w-[calc(100%+1.5rem)] gap-1 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
            {FILTERS.filter(
              f =>
                f.key === "now" ||
                f.key === "all" ||
                f.key === filter ||
                counts[f.key] > 0,
            ).map(f => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`shrink-0 ${chip(filter === f.key)}`}
              >
                {f.label}
                <span className="ml-1.5 tabular-nums opacity-60">
                  {counts[f.key]}
                </span>
              </button>
            ))}
          </div>
          <div className="relative w-full sm:ml-auto sm:w-56">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-8"
              placeholder="Find a client"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Find a client"
            />
          </div>
        </div>

        <div
          className={`hidden gap-4 border-b px-4 py-2 text-xs text-muted-foreground md:grid ${COLS}`}
        >
          <span>Client</span>
          <span>How they pay</span>
          <span>Next payment</span>
          <span>What to do</span>
          <span className="text-right">LTV</span>
          <span />
        </div>

        {rows.length ? (
          <ul>
            {rows.map(r => {
              const isOpen = open === r.taskId;
              const ltv = data.ltv?.[r.taskId];
              const last = data.lastPaid?.[r.taskId];
              const isPaused = r.group === "paused";
              const due = isPaused
                ? r.pausedOn
                  ? `paused ${shortDay(r.pausedOn)}, day ${-(r.ladder.days ?? 0)} of 15`
                  : "paused, no pause date"
                : r.nextDate
                  ? `${shortDay(r.nextDate)}, ${when(r.ladder.days)}`
                  : "no date on the card";
              return (
                <li key={r.taskId} className="border-b last:border-b-0">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : r.taskId)}
                    className={`grid w-full gap-x-4 gap-y-1.5 px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none sm:px-4 md:items-center ${COLS} ${isOpen ? "bg-muted/30" : ""}`}
                  >
                    {/* Client, and on a phone the amount beside it */}
                    <span className="flex min-w-0 items-baseline justify-between gap-3">
                      <span className="min-w-0">
                        <span className="line-clamp-2 font-medium" dir="auto">
                          {r.name}
                        </span>
                        <span className="hidden truncate text-xs text-muted-foreground md:block">
                          {r.status ?? "No status"}
                          {r.extensionWeeks
                            ? `, extended ${plural(r.extensionWeeks, "week")}`
                            : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular-nums md:hidden">
                        {isPaused ? "" : usd(r.nextUsd)}
                      </span>
                    </span>

                    <span className="hidden min-w-0 text-sm md:block">
                      <span
                        className={`block truncate ${r.method ? "" : "text-muted-foreground"}`}
                      >
                        {r.method ??
                          (r.group === "active" ? "No method set" : "—")}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.plan ?? "No plan"}
                      </span>
                    </span>

                    <span className="grid min-w-0 gap-1">
                      <span className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
                        <span className="hidden font-medium md:inline">
                          {isPaused ? "—" : usd(r.nextUsd)}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {due}
                        </span>
                      </span>
                      {isPaused ? (
                        <span className="hidden h-2.5 md:block" />
                      ) : (
                        <Strip days={r.ladder.days} tone={r.ladder.tone} />
                      )}
                    </span>

                    <span className="flex min-w-0 items-center justify-between gap-3">
                      <Step ladder={r.ladder} />
                      <ChevronDown
                        className={`size-4 shrink-0 text-muted-foreground transition-transform md:hidden ${isOpen ? "rotate-180" : ""}`}
                        aria-hidden
                      />
                    </span>

                    <span className="hidden text-sm tabular-nums md:block md:text-right">
                      <span className="block">
                        {ltv ? usd(ltv.target) : usd(r.ltvFieldUsd)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {last ? `paid ${shortDay(last.day)}` : "none tied"}
                      </span>
                    </span>

                    <ChevronDown
                      className={`hidden size-4 text-muted-foreground transition-transform md:block ${isOpen ? "rotate-180" : ""}`}
                      aria-hidden
                    />
                  </button>
                  {isOpen ? (
                    <Panel
                      row={r}
                      api={api}
                      events={data.events}
                      today={data.today}
                      ltv={ltv}
                      lastPaid={last}
                      notice={notice?.taskId === r.taskId ? notice.text : null}
                      onDone={(text, updated) =>
                        settle(r.taskId, text, updated)
                      }
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="grid gap-1 px-4 py-10 text-center">
            <p className="text-sm font-medium">
              {query.trim()
                ? `No client called "${query.trim()}" in this view.`
                : filter === "now"
                  ? "Nobody needs anything today."
                  : "Nobody here right now."}
            </p>
            <p className="text-sm text-muted-foreground">
              {query.trim()
                ? "Try Everyone, or check the spelling on the card."
                : "Everyone shows every client on the books."}
            </p>
          </div>
        )}
        <p className="max-w-3xl border-t px-3 py-3 text-xs leading-relaxed text-muted-foreground sm:px-4">
          From the Clients - Mahara cards in ClickUp
          {read ? `, read ${read}` : ""}. ClickUp is the record: a change made
          here is written to the card first. Late and due count the next payment
          typed on each active card; paused clients are never counted late. The
          strip under each date runs ten days either side of today, the upright
          line.{" "}
          {data.ltv
            ? "LTV is the card's figure on 21 Sep plus every payment tied to the client since."
            : "LTV is the figure on the card."}
        </p>
      </section>

      {data.unassigned?.length && api.assign ? (
        <Unassigned
          data={data}
          api={api}
          onDone={text => {
            setBanner(text);
            void load();
          }}
        />
      ) : null}

      {data.inbox.length ? (
        <section className="rounded-xl border bg-card p-4 sm:p-6">
          <h3 className="font-semibold">Waiting for the ledger</h3>
          <p className="text-sm text-muted-foreground">
            Payments Maher or a success manager logged. The CEO cockpit takes
            each into the ledger at its next refresh, and skips any that is
            already there.
          </p>
          <ul className="mt-3 grid gap-1.5 text-sm">
            {data.inbox.map(i => (
              <li
                key={i.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b pb-1.5 last:border-b-0"
              >
                <span dir="auto">{i.client_name ?? i.clickup_task_id}</span>
                <span className="tabular-nums text-muted-foreground">
                  {i.currency === "KWD"
                    ? `${Number(i.amount).toLocaleString("en-US")} KWD`
                    : usd(Number(i.amount))}
                  , {shortDay(i.paid_on)}, logged by{" "}
                  {i.source === "maher"
                    ? "Maher"
                    : String(i.logged_by).split("@")[0]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card p-4 sm:p-6">
        <h3 className="font-semibold">Billing log</h3>
        <p className="text-sm text-muted-foreground">
          Every decision, from either cockpit or from Maher, newest first.
        </p>
        {data.events.length ? (
          <ul className="mt-3 grid gap-2 text-sm">
            {data.events.slice(0, 30).map(e => (
              <li
                key={e.id}
                className="grid gap-x-4 sm:grid-cols-[4.5rem_minmax(0,11rem)_minmax(0,1fr)]"
              >
                <span className="text-xs tabular-nums text-muted-foreground sm:text-sm">
                  {shortDay(e.at.slice(0, 10))}
                </span>
                <span className="truncate font-medium" dir="auto">
                  {e.client_name}
                </span>
                <span className="text-muted-foreground">{sentenceOf(e)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing decided yet. Open a client above; the first change shows up
            here with who made it.
          </p>
        )}
      </section>
    </div>
  );
}

function Unassigned({
  data,
  api,
  onDone,
}: {
  data: BillingPayload;
  api: BillingApi;
  onDone: (text: string) => void;
}) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  // Every client card, the ones that have left too: their money is LTV.
  const clients = useMemo(
    () => data.cards.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [data.cards],
  );
  const list = data.unassigned ?? [];
  const total = list.reduce((n, u) => n + u.usd, 0);
  const shown = all ? list : list.slice(0, 8);
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-6">
      <h3 className="font-semibold">Money not tied to a client</h3>
      <p className="max-w-2xl text-sm text-muted-foreground">
        {usd(Math.round(total))} from {plural(list.length, "payer")} in the last
        twelve months. Tie a payer to their client once and their payments count
        as that client's money from the next refresh. LTV adds only payments
        from 19 September on: anything earlier is taken to be in the LTV already
        typed on the card, so a backlogged payment is never counted twice.
      </p>
      <ul className="mt-4 grid gap-3">
        {shown.map(u => (
          <li
            key={u.payer}
            className="grid gap-2 border-b pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_6rem_minmax(0,15rem)_auto] sm:items-center sm:gap-4"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium" dir="auto">
                {u.payer}
              </span>
              <span className="block text-xs text-muted-foreground">
                {plural(u.count, "payment")}, last {shortDay(u.last)}, by{" "}
                {u.rails.map(r => RAIL[r] ?? r).join(" and ")}
              </span>
            </span>
            <span className="text-sm font-medium tabular-nums sm:text-right">
              {usd(u.usd)}
            </span>
            <AnimatedSelect
              className={select}
              aria-label={`Which client ${u.payer} is`}
              value={pick[u.payer] ?? ""}
              onChange={e =>
                setPick(p => ({ ...p, [u.payer]: e.target.value }))
              }
            >
              <option value="">Which client is this?</option>
              {clients.map(c => (
                <option key={c.taskId} value={c.taskId}>
                  {c.group === "gone" ? `${c.name} (left)` : c.name}
                </option>
              ))}
            </AnimatedSelect>
            <Button
              size="sm"
              variant="outline"
              disabled={!pick[u.payer] || busy !== null}
              onClick={async () => {
                const c = clients.find(x => x.taskId === pick[u.payer]);
                if (!c || !api.assign) return;
                setBusy(u.payer);
                setError(null);
                try {
                  onDone(
                    await api.assign({
                      payer: u.payer,
                      taskId: c.taskId,
                      clientName: c.name,
                      usd: u.usd,
                      count: u.count,
                    }),
                  );
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === u.payer ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              Tie to client
            </Button>
          </li>
        ))}
      </ul>
      {list.length > 8 ? (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() => setAll(a => !a)}
        >
          {all ? "Show the biggest eight" : `Show all ${list.length}`}
        </Button>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
