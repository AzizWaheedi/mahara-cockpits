import { ArrowUpRight, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import {
  type ChipKey,
  type Confirmable,
  type ConfirmationView,
  type ConfirmPart,
  dayText,
  type Figure,
  type Hint,
  type Part,
  type PendingRow,
  type PendingView,
  type PossiblePayment,
  type RibbonState,
  type SalesRow,
  type Tone,
  type UnlinkedRow,
  usdText,
} from "@/lib/billingBalances";

/*
 * Hallmark · component: section · genre: modern-minimal · theme: the cockpit's own
 * states: default · hover · focus · active · disabled · loading · error · success
 * pre-emit critique: P4 H4 E4 S5 R4 V4
 *
 * Pending payments: signed clients who have not finished paying, part by
 * part. The same file in the CEO cockpit and the client success cockpit
 * (scripts/check-shared.sh holds it to that), inside the billing sheet, wired
 * to each app's own calls through `api`. The rule is
 * src/lib/billingBalances.ts; this file only draws what it returns.
 *
 * Aziz, 2026-10-23: "people who have pending payments in onboarding ... they
 * pay the deposit, and then on the onboarding call, they pay the rest. They
 * just need to confirm that the money was paid ... Anybody who hasn't
 * finished the rest of the payment could also go into the payment section."
 *
 * Design plan (hw-notes/billing-pending/PLAN.md 4.1, as built):
 * - Subject. A success manager, the morning of an onboarding call, needs
 *   who still owes the rest, how much and by which day, then "it's paid" in
 *   two taps. The CEO reads the same list for the whole book, plus the
 *   money only he can tie.
 * - Tokens. No new palette. The sheet's STYLE block carries the roles
 *   (--b-rail teal, --b-person teal hatch, --b-due destructive, --b-another
 *   orange hatch, --b-line); FILL below only names them. The hatch, not the
 *   colour, says "a person's word", so the ribbon reads in grey too.
 * - Type. Geist 600 for client names, 400 for words, tabular figures for
 *   money, Geist Mono 11px only under the ribbon. No italics, no caps.
 * - Layout. One card. A figure line that is also the ribbon's legend, chips,
 *   then rows that open in place. Container queries (@3xl), not viewport
 *   breakpoints, because the CEO rail eats 224px. Below @3xl a row is three
 *   lines: name and amount; part and due; the full-width ribbon.
 * - Signature: the contract ribbon. One 6px bar per client cut at the
 *   plan's real parts in proportion to their dollars, 2px gaps between
 *   parts, a 1px tick before the part due next. Teal for rail money, teal
 *   hatch for a confirmation, red for due and not seen, orange hatch for
 *   another source, a quiet track for not due.
 * - Against the template. Not one percentage bar, not a red "Overdue" pill,
 *   not "Mark as paid": the bar is cut at the plan's parts, a person's word
 *   and another source each get a hatch, and the button is Confirm paid,
 *   whose result reads "Confirmed by you · waiting for Tap", never "Paid".
 *   Status colour sits on dots and segments, never on text.
 *
 * Seats. The server never sends a success manager the CEO's groups (deals
 * with no card, Back with sales, untied money, payer and contact names);
 * this file also draws them only when the read says the caller is the CEO.
 */

// --- what the cockpit wires in ---------------------------------------------

export type ConfirmInput = {
  taskId: string;
  dealResponseId: string | null;
  part: ConfirmPart;
  partNo: number;
  amount: number;
  currency: "USD" | "KWD";
  rail: "whop" | "tap" | "ecom";
  paidOn: string;
  evidenceUrl: string | null;
  note: string | null;
};

export type PendingApi = {
  /** cockpit_billing_balances_read() for the signed-in seat, through the rule. */
  read: () => Promise<PendingView>;
  /** Returns the server's sentence ("Confirmed by you · waiting for Tap"). */
  confirm: (p: ConfirmInput) => Promise<string>;
  withdraw: (p: {
    taskId: string;
    confirmationId: number;
    reason: string;
  }) => Promise<string>;
  /** CEO cockpit only. */
  link?: (p: { dealResponseId: string; taskId: string }) => Promise<string>;
  /** CEO cockpit only. */
  unlink?: (p: { dealResponseId: string; reason: string }) => Promise<string>;
  /** CEO cockpit only: open Money's tie sheet for this untied payment. */
  openTie?: (paymentId: string) => void;
  /**
   * CEO cockpit only (20261024p): leave a payment the row's deal holds out of
   * program money (the website), so it fills no part. Cash, ties and pay are
   * left as they are. Returns the server's sentence.
   */
  exclude?: (p: {
    taskId: string;
    dealResponseId: string;
    paymentId: string;
    reason: "website" | "other";
    note: string | null;
  }) => Promise<string>;
  /** CEO cockpit only: count a payment left out of program money again. */
  unexclude?: (p: { paymentId: string; reason: string }) => Promise<string>;
};

/**
 * Opens the sheet's own "Log a payment" form for a client; false when the
 * sheet has no such row. The amount comes in the currency it was typed in,
 * so a dinar figure never lands in the form as dollars.
 */
export type LogPaymentHandoff = (p: {
  taskId: string;
  name: string;
  amount: number | null;
  currency: "USD" | "KWD";
  note: string;
}) => boolean;

/** A card the CEO may link a deal with no card to (the sheet's own list). */
export type LinkableCard = { taskId: string; name: string; group: string };

/** Writes the plan's next part on the ClickUp card through the sheet's edit path. */
export type SetCardNext = (p: {
  taskId: string;
  usd: number;
  date: string;
  label: string;
}) => Promise<string>;

// --- look ------------------------------------------------------------------

const TONE: Record<Tone, string> = {
  neutral: "color-mix(in srgb, currentColor 30%, transparent)",
  good: "var(--b-good, var(--success))",
  warning: "var(--b-warning, var(--warning))",
  serious:
    "var(--b-serious, color-mix(in oklch, var(--warning) 45%, var(--destructive)))",
  critical: "var(--b-critical, var(--destructive))",
};

const hatch = (token: string) =>
  `repeating-linear-gradient(135deg, ${token} 0 1.5px, transparent 1.5px 4px), color-mix(in srgb, ${token} 22%, transparent)`;

/** The ribbon's fills, by name only: the roles live in the sheet's STYLE block. */
const FILL: Record<RibbonState, string> = {
  rails: "var(--b-rail, var(--primary))",
  person: hatch("var(--b-person, var(--primary))"),
  notSeen: "var(--b-due, var(--destructive))",
  another: hatch("var(--b-another, var(--warning))"),
  notDue: "var(--b-line, color-mix(in srgb, currentColor 14%, transparent))",
};

const chip = (on: boolean) =>
  `inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? "border-primary/40 bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`;
const select =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm";
const label = "text-xs font-medium text-muted-foreground";
const spin = "animate-spin motion-reduce:animate-none";
const COLS =
  "@3xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1.45fr)_minmax(0,1.35fr)_minmax(0,0.8fr)_1rem]";
const SHOWN = 5;

const RAIL_WORD: Record<string, string> = {
  whop: "Whop",
  tap: "Tap",
  ecom: "Ecom",
  manual: "a transfer",
  transfer: "a transfer",
};
const railWord = (r: string | null | undefined) =>
  RAIL_WORD[String(r ?? "").toLowerCase()] ?? String(r ?? "a rail");

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** "20:23", Kuwait time; null when there is no time to show. */
function kuwaitClock(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kuwait",
  });
}

/** What a refused call says, in the words the server wrote. */
function errorText(e: unknown): string {
  const data = (e as { data?: unknown } | null)?.data;
  if (typeof data === "string") return data;
  if (data && typeof (data as { message?: unknown }).message === "string")
    return (data as { message: string }).message;
  const raw = e instanceof Error ? e.message : String(e);
  return (
    raw.trim().slice(0, 300) ||
    "That did not save, so nothing changed. Try again in a minute."
  );
}

// --- small parts -----------------------------------------------------------

function Dot({ tone }: { tone: Tone }) {
  return (
    <span
      className="inline-block size-1.5 shrink-0 rounded-full"
      style={{ background: TONE[tone] }}
      aria-hidden
    />
  );
}

function Swatch({ state }: { state: RibbonState }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-[2px]"
      style={{ background: FILL[state] }}
      aria-hidden
    />
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
    <div className={`grid min-w-0 content-start gap-1 ${className ?? ""}`}>
      <label htmlFor={id} className={label}>
        {text}
      </label>
      {children(id)}
    </div>
  );
}

/** "Onboarding payment: $5,750 not seen, call 19 Oct (...)". */
function ribbonLabel(r: PendingRow, today: string): string {
  const head = `On a rail ${usdText(r.railsUsd)} of ${usdText(r.contractUsd)}.`;
  const parts = r.parts
    .filter(p => p.notSeen > 0 || p.another > 0 || p.person > 0 || p.next)
    .map(p => {
      const bits: string[] = [];
      if (p.notSeen > 0) bits.push(`${usdText(p.notSeen)} not seen`);
      if (p.another > 0)
        bits.push(`${usdText(p.another)} another source says paid`);
      if (p.person > 0) bits.push(`${usdText(p.person)} confirmed by a person`);
      if (!bits.length && p.notDue > 0)
        bits.push(`${usdText(p.notDue)} not due yet`);
      return `${p.label}: ${bits.join(", ")}${p.due ? `, due ${dayText(p.due, today)}` : ""}.`;
    });
  return [head, ...parts].join(" ");
}

/** The signature: the contract cut at the plan's parts. */
export function Ribbon({ row, today }: { row: PendingRow; today: string }) {
  return (
    <span
      role="img"
      aria-label={ribbonLabel(row, today)}
      className="flex h-1.5 w-full items-stretch gap-0.5"
    >
      {row.parts.map(p => {
        const segs = row.ribbon.filter(s => s.partKey === p.key);
        return (
          <span
            key={p.key}
            data-part={p.key}
            className="relative flex min-w-[3px]"
            style={{ flex: `${Math.max(p.usd, 0.01)} 1 0%` }}
          >
            <span className="flex w-full overflow-hidden rounded-[2px]">
              {segs.map(s => (
                <span
                  key={`${s.state}-${s.typed ? "t" : ""}`}
                  data-state={s.state}
                  className="block h-full"
                  style={{
                    flex: `${s.usd} 1 0%`,
                    background: FILL[s.state],
                  }}
                />
              ))}
            </span>
            {p.next ? (
              <span
                className="absolute -left-[1.5px] -top-[3px] h-3 w-px bg-foreground/70"
                data-next
                aria-hidden
              />
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/** The amount a row leads with, for the chip it is read under. */
function amountOf(
  r: PendingRow,
  chipKey: ChipKey,
  today: string,
): { usd: number | null; words: string } {
  // A card-only row leads with what its card asks, money read or not.
  if (r.cardOnly)
    return {
      usd: r.nextPart?.usd ?? null,
      words: r.nextPart?.due
        ? `card asks, ${dayText(r.nextPart.due, today)}`
        : "card asks",
    };
  if (!r.amountsKnown)
    return {
      usd: null,
      words: !r.deal
        ? "amount not known"
        : r.railsUsd === null
          ? "money not read"
          : "amount not known",
    };
  const own = r.chips.includes(chipKey)
    ? chipKey
    : (r.chips[0] ?? ("toCome" as ChipKey));
  switch (own) {
    case "onboarding": {
      if ((r.onboardingNotSeenUsd ?? 0) > 0 || !r.upcomingOnboardingUsd)
        return { usd: r.onboardingNotSeenUsd, words: "not seen" };
      // Not due yet: what the onboarding call still has to bring in.
      const call = r.parts.find(p => p.kind === "onboarding" && p.notDue > 0);
      return {
        usd: r.upcomingOnboardingUsd,
        words: call?.due ? `call ${dayText(call.due, today)}` : "at onboarding",
      };
    }
    case "later":
      return { usd: r.laterNotSeenUsd, words: "not seen" };
    case "another":
      return { usd: r.anotherUsd, words: "says paid" };
    case "toCome":
      return r.nextPart
        ? {
            usd: r.nextPart.usd,
            words: r.nextPart.due
              ? `next, ${dayText(r.nextPart.due, today)}`
              : "next, no day yet",
          }
        : r.personUsd > 0
          ? { usd: r.personUsd, words: "confirmed" }
          : { usd: r.leftUsd, words: "left" };
    default:
      return { usd: r.notSeenUsd, words: "not seen" };
  }
}

const COLUMN_WORD: Record<ChipKey, string> = {
  notSeen: "Not seen",
  onboarding: "Still to pay",
  later: "Not seen",
  another: "Says paid",
  toCome: "Next part",
};

function Amount({
  row,
  chipKey,
  today,
}: {
  row: PendingRow;
  chipKey: ChipKey;
  today: string;
}) {
  const a = amountOf(row, chipKey, today);
  return (
    <span className="grid justify-items-end gap-0.5">
      <span className="inline-flex items-center gap-1.5">
        <Dot tone={row.tone} />
        <span className="font-semibold tabular-nums">{usdText(a.usd)}</span>
      </span>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {a.words}
      </span>
    </span>
  );
}

// --- the figure line, which is also the ribbon's legend ---------------------

function FigureItem({
  state,
  title,
  figure,
  unit = "client",
}: {
  state: RibbonState;
  title: string;
  figure: Figure;
  unit?: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="inline-flex items-baseline gap-2 text-sm text-muted-foreground">
        <span className="relative top-px">
          <Swatch state={state} />
        </span>
        {title}
      </dt>
      <dd className="whitespace-nowrap text-sm">
        <span className="font-semibold tabular-nums text-foreground">
          {usdText(figure.usd)}
        </span>
        {figure.usd === null ? null : (
          <span className="text-muted-foreground">
            {" "}
            · {plural(figure.count, unit)}
          </span>
        )}
      </dd>
    </div>
  );
}

function Figures({ view }: { view: PendingView }) {
  const f = view.figures;
  const unknown = Math.max(
    f.notSeen.unknown,
    f.another.unknown,
    f.person.unknown,
  );
  return (
    <div className="grid gap-2">
      <dl className="flex flex-wrap gap-x-6 gap-y-1.5">
        <FigureItem
          state="notSeen"
          title="Onboarding not seen"
          figure={f.onboarding}
        />
        <FigureItem state="notSeen" title="Later parts" figure={f.later} />
        {f.upcoming.count > 0 || f.upcoming.unknown > 0 ? (
          <FigureItem
            state="notDue"
            title="Expected on upcoming onboarding calls"
            figure={f.upcoming}
          />
        ) : null}
        <FigureItem
          state="another"
          title="Another source says paid"
          figure={f.another}
        />
        <FigureItem
          state="person"
          title="Confirmed by a person"
          figure={f.person}
        />
      </dl>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Swatch state="rails" />
          On a rail
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Swatch state="notDue" />
          Not due yet
        </span>
        {(f.typed.usd ?? 0) > 0 ? (
          <span>
            {usdText(f.typed.usd)} of Not seen is only typed on closer forms,
            never on a rail.
          </span>
        ) : null}
        {unknown > 0 && !view.moneyMissing ? (
          <span>
            {plural(unknown, "listed client")} {unknown === 1 ? "has" : "have"}{" "}
            no amount we can work out yet, so the figures leave{" "}
            {unknown === 1 ? "it" : "them"} out.
          </span>
        ) : null}
      </p>
    </div>
  );
}

// --- confirming a payment ----------------------------------------------------

type PayRail = "whop" | "tap" | "ecom" | "manual";
const RAILS: { key: PayRail; label: string }[] = [
  { key: "whop", label: "Whop" },
  { key: "tap", label: "Tap" },
  { key: "ecom", label: "Ecom link" },
  { key: "manual", label: "Bank transfer, cheque or cash" },
];

function ConfirmForm({
  api,
  name,
  taskId,
  dealResponseId,
  confirmable,
  preferred,
  signedOn,
  today,
  ceo,
  onLogPayment,
  logBlocked,
  onDone,
}: {
  api: PendingApi;
  name: string;
  taskId: string;
  dealResponseId: string | null;
  confirmable: Confirmable[];
  /** The part to start on (the one due and not seen), as "part:partNo". */
  preferred: string | null;
  signedOn: string | null;
  today: string;
  ceo: boolean;
  onLogPayment?: LogPaymentHandoff;
  /** Why this client's transfer cannot be logged from here, and where it can. */
  logBlocked?: string;
  onDone: (sentence: string) => void;
}) {
  const keyOf = (c: Confirmable) => `${c.part}:${c.partNo}`;
  const first = Math.max(
    0,
    confirmable.findIndex(c => keyOf(c) === preferred),
  );
  const [pick, setPick] = useState(first);
  const part = confirmable[Math.min(pick, confirmable.length - 1)];
  const [rail, setRail] = useState<PayRail | null>(null);
  const [day, setDay] = useState(today);
  const [amount, setAmount] = useState(
    part?.emptyUsd !== null && part?.emptyUsd !== undefined
      ? String(part.emptyUsd)
      : "",
  );
  const [currency, setCurrency] = useState<"USD" | "KWD">("USD");
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!part)
    return (
      <p className="text-sm text-muted-foreground">
        Nothing left to confirm: every part is on a rail or held by a
        confirmation.
      </p>
    );

  const n = Number(amount);
  const link = evidence.trim();
  const badLink = link !== "" && !/^https:\/\/\S+$/i.test(link);
  const minDay = signedOn ? addDays(signedOn, -7) : undefined;
  const dayProblem = !day
    ? "Pick the day they paid."
    : day > today
      ? "The day they paid cannot be after today."
      : minDay && day < minDay
        ? `The day they paid cannot be more than a week before they signed (${dayText(signedOn, today)}).`
        : null;
  const ready =
    rail !== null &&
    rail !== "manual" &&
    Number.isFinite(n) &&
    n > 0 &&
    !badLink &&
    !dayProblem;

  const confirm = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const sentence = await api.confirm({
        taskId,
        dealResponseId,
        part: part.part,
        partNo: part.partNo,
        amount: n,
        currency,
        rail,
        paidOn: day,
        evidenceUrl: link || null,
        note: note.trim() || null,
      });
      onDone(sentence);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="@container grid min-w-0 content-start gap-3">
      <h4 className="text-sm font-medium">Confirm a payment</h4>
      {confirmable.length > 1 ? (
        <Field label="Which part" className="@md:max-w-sm">
          {id => (
            <AnimatedSelect
              id={id}
              className={select}
              value={String(pick)}
              onChange={e => {
                const i = Number(e.target.value);
                setPick(i);
                const c = confirmable[i];
                setAmount(
                  c?.emptyUsd !== null && c?.emptyUsd !== undefined
                    ? String(c.emptyUsd)
                    : "",
                );
                setError(null);
              }}
            >
              {confirmable.map((c, i) => (
                <option key={keyOf(c)} value={String(i)}>
                  {c.emptyUsd === null
                    ? c.label
                    : `${c.label} · ${usdText(c.emptyUsd)} open`}
                </option>
              ))}
            </AnimatedSelect>
          )}
        </Field>
      ) : (
        <p className="text-sm">
          {part.label}
          <span className="text-muted-foreground">
            {part.emptyUsd === null
              ? " · amount not known"
              : ` · ${usdText(part.emptyUsd)} open`}
          </span>
        </p>
      )}

      <div className="grid gap-1.5">
        <span className={label} id={`${taskId}-how`}>
          How did they pay?
        </span>
        <div
          className="flex flex-wrap gap-1"
          role="radiogroup"
          aria-labelledby={`${taskId}-how`}
        >
          {RAILS.map(r => (
            <button
              key={r.key}
              type="button"
              role="radio"
              aria-checked={rail === r.key}
              onClick={() => {
                setRail(r.key);
                setError(null);
              }}
              className={chip(rail === r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {rail === "manual" ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            A transfer, cheque or cash never arrives on its own, so it is logged
            as a payment with its receipt.
            {logBlocked
              ? null
              : ceo
                ? " It goes straight into the ledger."
                : " It waits in the billing inbox until the CEO cockpit takes it in."}
          </p>
          {logBlocked || !onLogPayment ? (
            <p className="text-sm">
              {logBlocked ??
                "Log the transfer from this client's row in the billing sheet."}
            </p>
          ) : (
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setError(null);
                  // What the hidden form holds goes over in its own
                  // currency; untouched, it is the part's open dollars.
                  const typed = Number.isFinite(n) && n > 0;
                  const opened = onLogPayment({
                    taskId,
                    name,
                    amount: typed ? n : part.emptyUsd,
                    currency: typed ? currency : "USD",
                    note: `${part.label}, from Pending payments`,
                  });
                  if (!opened)
                    setError(
                      `${name} is not in the billing sheet below yet, so its payment form cannot open. Reload the page, then try again.`,
                    );
                }}
              >
                Log it as a payment
              </Button>
            </div>
          )}
        </div>
      ) : rail ? (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3 @md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_6rem]">
            <Field label="Paid on">
              {id => (
                <DateInput
                  id={id}
                  min={minDay}
                  max={today}
                  value={day}
                  onChange={e => setDay(e.target.value)}
                />
              )}
            </Field>
            <Field label="Amount">
              {id => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                />
              )}
            </Field>
            <Field label="Currency">
              {id => (
                <AnimatedSelect
                  id={id}
                  className={select}
                  value={currency}
                  onChange={e => setCurrency(e.target.value as "USD" | "KWD")}
                >
                  <option value="USD">USD</option>
                  <option value="KWD">KWD</option>
                </AnimatedSelect>
              )}
            </Field>
          </div>
          <div className="grid gap-3 @md:grid-cols-2">
            <Field label="Receipt link (optional)">
              {id => (
                <Input
                  id={id}
                  value={evidence}
                  onChange={e => setEvidence(e.target.value)}
                  placeholder="https://"
                  aria-invalid={badLink || undefined}
                />
              )}
            </Field>
            <Field label="Note (optional)">
              {id => (
                <Input
                  id={id}
                  value={note}
                  maxLength={500}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Paid on the onboarding call"
                />
              )}
            </Field>
          </div>
          {currency === "KWD" && n > 0 ? (
            <p className="text-xs text-muted-foreground">
              Counted as {usdText(Math.round(n * 3.26 * 100) / 100)} at 3.26
              dollars a dinar.
            </p>
          ) : null}
          {badLink ? (
            <p className="flex items-start gap-2 text-xs">
              <span className="mt-1">
                <Dot tone="warning" />
              </span>
              A receipt link starts with https://.
            </p>
          ) : null}
          {dayProblem ? (
            <p className="flex items-start gap-2 text-xs">
              <span className="mt-1">
                <Dot tone="warning" />
              </span>
              {dayProblem}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Your word, not money: it holds the part until {railWord(rail)} shows
            the payment, and never counts toward cash, LTV or pay.
          </p>
          <div>
            <Button size="sm" disabled={busy || !ready} onClick={confirm}>
              {busy ? <Loader2 className={spin} aria-hidden /> : null}
              {busy ? "Confirming" : "Confirm paid"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Pick how they paid. Whop, Tap and Ecom arrive by themselves, so a
          confirmation waits for them; anything else is logged as a payment.
        </p>
      )}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// --- what is already confirmed ---------------------------------------------

function Confirmations({
  api,
  taskId,
  list,
  ceo,
  today,
  onDone,
}: {
  api: PendingApi;
  taskId: string;
  list: ConfirmationView[];
  ceo: boolean;
  today: string;
  onDone: (sentence: string) => void;
}) {
  const [asking, setAsking] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!list.length) return null;
  const withdraw = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      const sentence = await api.withdraw({
        taskId,
        confirmationId: id,
        reason: reason.trim(),
      });
      setAsking(null);
      setReason("");
      onDone(sentence);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2">
      <h4 className="text-sm font-medium">Confirmations</h4>
      <ul className="grid gap-2">
        {list.map(c => {
          const mayWithdraw = !c.withdrawnAt && (c.byYou === true || ceo);
          return (
            <li key={c.id} className="grid gap-1 text-sm">
              <span className="flex items-baseline gap-2">
                <span className="relative top-px">
                  <Swatch
                    state={
                      c.state === "proven"
                        ? "rails"
                        : c.state === "withdrawn"
                          ? "notDue"
                          : "person"
                    }
                  />
                </span>
                <span className="min-w-0">
                  <span className="tabular-nums">
                    {usdText(c.usd)}
                    {c.currency === "KWD"
                      ? ` (${c.amount.toLocaleString("en-US")} KWD)`
                      : ""}
                  </span>{" "}
                  {railWord(c.rail)}, paid {dayText(c.paidOn, today)}
                  <span className="block text-xs text-muted-foreground">
                    {c.line}
                    {c.note ? `. ${c.note}` : ""}
                  </span>
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-[1.125rem]">
                {c.evidenceUrl ? (
                  <a
                    href={c.evidenceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Receipt
                    <ArrowUpRight className="size-3" aria-hidden />
                  </a>
                ) : null}
                {mayWithdraw && asking !== c.id ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => {
                      setAsking(c.id);
                      setReason("");
                      setError(null);
                    }}
                  >
                    Withdraw
                  </Button>
                ) : null}
              </span>
              {asking === c.id ? (
                <span className="grid gap-2 pl-[1.125rem]">
                  <Field label="Why it is withdrawn">
                    {id => (
                      <Input
                        id={id}
                        value={reason}
                        maxLength={300}
                        onChange={e => setReason(e.target.value)}
                        placeholder="Confirmed the wrong client"
                      />
                    )}
                  </Field>
                  <span className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || reason.trim().length < 3}
                      onClick={() => withdraw(c.id)}
                    >
                      {busy ? <Loader2 className={spin} aria-hidden /> : null}
                      {busy ? "Withdrawing" : "Withdraw"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setAsking(null)}
                    >
                      Keep it
                    </Button>
                  </span>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// --- the CEO's possible money -------------------------------------------------

function paymentWords(p: {
  rail: string;
  day: string;
  usd: number;
  currency: string | null;
  amount: number | null;
}): string {
  return `${railWord(p.rail)} ${usdText(p.usd)}${
    p.currency && p.currency !== "USD" && p.amount !== null
      ? ` (${p.amount.toLocaleString("en-US")} ${p.currency})`
      : ""
  }, ${dayText(p.day)}`;
}

function TieButton({ api, paymentId }: { api: PendingApi; paymentId: string }) {
  return api.openTie ? (
    <Button
      size="sm"
      variant="outline"
      className="shrink-0"
      onClick={() => api.openTie?.(paymentId)}
    >
      Tie it
    </Button>
  ) : (
    <span className="text-xs text-muted-foreground">
      Tie it on the CEO cockpit's Transactions tab.
    </span>
  );
}

function RowHints({ api, hints }: { api: PendingApi; hints: Hint[] }) {
  const [all, setAll] = useState(false);
  if (!hints.length) return null;
  const shown = all ? hints : hints.slice(0, 3);
  return (
    <div className="grid gap-2">
      <h4 className="text-sm font-medium">Possible money</h4>
      <p className="text-xs text-muted-foreground">
        Untied payments that fit a part of this plan with room left. None of
        them counts until you tie it to the deal.
      </p>
      <ul className="grid gap-2">
        {shown.map(h => (
          <li
            key={`${h.paymentId}-${h.partKey}`}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
          >
            <span className="min-w-0">
              <span className="tabular-nums">{paymentWords(h)}</span>
              {h.payerName ? (
                <>
                  {" "}
                  from <bdi>{h.payerName}</bdi>
                </>
              ) : null}
              <span className="block text-xs text-muted-foreground">
                {h.partLabel} · {h.why}
              </span>
            </span>
            <TieButton api={api} paymentId={h.paymentId} />
          </li>
        ))}
      </ul>
      {hints.length > 3 ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setAll(a => !a)}>
            {all ? "Show the first 3" : `Show all ${hints.length}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// --- one client, opened -----------------------------------------------------

function partWords(p: Part): string {
  const bits: string[] = [];
  if (p.rails > 0)
    bits.push(p.rails >= p.usd ? "on a rail" : `${usdText(p.rails)} on a rail`);
  if (p.person > 0) bits.push(`${usdText(p.person)} confirmed by a person`);
  if (p.notSeen > 0)
    bits.push(
      `${usdText(p.notSeen)} not seen${p.typed > 0 ? ` (${usdText(p.typed)} of it only typed on the closer form)` : ""}`,
    );
  if (p.another > 0)
    bits.push(`${usdText(p.another)} another source says paid`);
  if (p.notDue > 0)
    bits.push(
      p.notDue >= p.usd ? "not due yet" : `${usdText(p.notDue)} not due yet`,
    );
  return bits.join(" · ");
}

function partState(p: Part): RibbonState {
  if (p.notSeen > 0) return "notSeen";
  if (p.another > 0) return "another";
  if (p.person > 0) return "person";
  if (p.rails > 0 && p.notDue === 0) return "rails";
  return p.rails > 0 ? "rails" : "notDue";
}

function lateWords(p: Part): string {
  if (!(p.notSeen > 0 || p.another > 0) || p.daysLate === null) return "";
  if (p.daysLate > 0) return ` · ${plural(p.daysLate, "day")} late`;
  if (p.daysLate === 0) return " · due today";
  return ` · in ${plural(-p.daysLate, "day")}`;
}

function Parts({ row, today }: { row: PendingRow; today: string }) {
  // Amounts nobody can work out are never drawn as parts (missing is never zero).
  if (!row.parts.length || !row.amountsKnown) return null;
  return (
    <div className="grid gap-2">
      <h4 className="text-sm font-medium">Part by part</h4>
      <ol className="grid gap-2.5">
        {row.parts.map(p => (
          <li
            key={p.key}
            className="grid grid-cols-[0.625rem_minmax(0,1fr)_auto] items-baseline gap-x-2 text-sm"
          >
            <span className="relative top-px">
              <Swatch state={partState(p)} />
            </span>
            <span className="min-w-0">
              <span className="font-medium">{p.label}</span>
              {p.next ? (
                <span className="text-muted-foreground"> · next</span>
              ) : null}
              <span className="block text-xs text-muted-foreground">
                {partWords(p)}
              </span>
              <span className="block text-xs text-muted-foreground">
                {p.due
                  ? p.dueLine || `Due ${dayText(p.due, today)}`
                  : p.dueLine || "No due day yet"}
                {lateWords(p)}
              </span>
              {p.signals.map(s => (
                <span key={s} className="block text-xs text-muted-foreground">
                  {s}
                </span>
              ))}
            </span>
            <span className="tabular-nums">{usdText(p.usd)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CardNext({
  row,
  today,
  onSetCardNext,
  onDone,
}: {
  row: PendingRow;
  today: string;
  onSetCardNext?: SetCardNext;
  onDone: (sentence: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = row.cardNext;
  if (!next?.date || !row.nextPart || !onSetCardNext) return null;
  const differs =
    next.amountDiffers && next.dateDiffers
      ? "amount and date"
      : next.amountDiffers
        ? "amount"
        : "date";
  return (
    <div className="grid gap-2">
      <h4 className="text-sm font-medium">Put the next part on the card</h4>
      <p className="text-sm text-muted-foreground">
        The plan's next part is {row.nextPart.label.toLowerCase()},{" "}
        {usdText(next.usd)} on {dayText(next.date, today)}. The card's next{" "}
        {differs} {differs === "amount and date" ? "are" : "is"} blank or
        different.
      </p>
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              onDone(
                await onSetCardNext({
                  taskId: row.taskId,
                  usd: next.usd,
                  date: next.date as string,
                  label: row.nextPart?.label ?? "Next part",
                }),
              );
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className={spin} aria-hidden /> : null}
          {busy ? "Setting" : "Set on the card"}
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Unlink({
  api,
  row,
  onDone,
}: {
  api: PendingApi;
  row: PendingRow;
  onDone: (sentence: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deal = row.deal;
  if (deal?.matchedBy !== "link" || !api.unlink) return null;
  return (
    <div className="grid gap-2">
      {asking ? (
        <>
          <Field label="Why it is unlinked">
            {id => (
              <Input
                id={id}
                value={reason}
                maxLength={300}
                onChange={e => setReason(e.target.value)}
                placeholder="Linked to the wrong card"
              />
            )}
          </Field>
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || reason.trim().length < 3}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  onDone(
                    (await api.unlink?.({
                      dealResponseId: deal.responseId,
                      reason: reason.trim(),
                    })) ?? "Unlinked.",
                  );
                  setAsking(false);
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className={spin} aria-hidden /> : null}
              {busy ? "Unlinking" : "Unlink the closer form"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setAsking(false)}
            >
              Keep it
            </Button>
          </span>
        </>
      ) : (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>
            Unlink the closer form
          </Button>
        </div>
      )}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * CEO only (20261024p): a payment the client's deal holds that was not
 * program money, such as the website sold beside the program. Leaving it out
 * stops this section counting it toward the plan; the money refresh, ties,
 * cash and pay are left as they are. A payment left out can be counted again.
 */
function ProgramMoney({
  api,
  row,
  today,
  onDone,
  onSection,
}: {
  api: PendingApi;
  row: PendingRow;
  today: string;
  onDone: (sentence: string) => void;
  /** Counting a payment again can finish the row, so its sentence shows on the section. */
  onSection: (sentence: string) => void;
}) {
  // null: closed; "out": leaving a payment out; a payment id: counting it again.
  const [mode, setMode] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const [why, setWhy] = useState<"website" | "other">("website");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deal = row.deal;
  const { exclude, unexclude } = api;
  if (!deal || !exclude || !unexclude) return null;
  if (row.rails.length === 0 && row.excluded.length === 0) return null;
  const chosen = row.rails.some(r => r.paymentId === pick)
    ? pick
    : (row.rails[0]?.paymentId ?? "");
  const open = (next: string | null) => {
    setMode(next);
    setError(null);
    setReason("");
    setNote("");
  };
  const send = async (
    write: () => Promise<string>,
    done: (sentence: string) => void,
  ) => {
    setBusy(true);
    setError(null);
    try {
      done(await write());
      open(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const paymentWords = (r: { rail: string; usd: number; day: string }) =>
    `${railWord(r.rail)} ${usdText(r.usd)} on ${dayText(r.day, today)}`;
  // Two payments alike (Castello's two $1,500 of 21 Aug) are told apart by their id.
  const alike = (r: { rail: string; usd: number; day: string }) =>
    row.rails.filter(o => paymentWords(o) === paymentWords(r)).length > 1;
  const optionWords = (r: (typeof row.rails)[number]) =>
    alike(r)
      ? `${paymentWords(r)} · ${r.paymentId.slice(r.paymentId.indexOf(":") + 1)}`
      : paymentWords(r);
  return (
    <div className="grid gap-2">
      {row.excluded.map(x =>
        mode === x.paymentId ? (
          <div key={x.paymentId} className="grid gap-2">
            <Field label={`Why ${paymentWords(x)} counts again`}>
              {id => (
                <Input
                  id={id}
                  value={reason}
                  maxLength={300}
                  onChange={e => setReason(e.target.value)}
                  placeholder="It was program money after all"
                />
              )}
            </Field>
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || reason.trim().length < 3}
                onClick={() =>
                  send(
                    () =>
                      unexclude({
                        paymentId: x.paymentId,
                        reason: reason.trim(),
                      }),
                    onSection,
                  )
                }
              >
                {busy ? <Loader2 className={spin} aria-hidden /> : null}
                {busy ? "Counting it again" : "Count it again"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => open(null)}
              >
                Keep it out
              </Button>
            </span>
          </div>
        ) : mode === null ? (
          <div key={x.paymentId}>
            <Button size="sm" variant="ghost" onClick={() => open(x.paymentId)}>
              {`Count ${usdText(x.usd)} on ${dayText(x.day, today)} again`}
            </Button>
          </div>
        ) : null,
      )}
      {mode === "out" ? (
        <div className="grid gap-3">
          <p className="text-xs text-muted-foreground">
            It stops counting toward the plan here. Cash, ties and pay stay as
            they are.
          </p>
          <div className="grid gap-3 @md:grid-cols-2">
            <Field label="Payment">
              {id => (
                <AnimatedSelect
                  id={id}
                  className={select}
                  value={chosen}
                  onChange={e => {
                    setPick(e.target.value);
                    setError(null);
                  }}
                >
                  {row.rails.map(r => (
                    <option key={r.paymentId} value={r.paymentId}>
                      {optionWords(r)}
                    </option>
                  ))}
                </AnimatedSelect>
              )}
            </Field>
            <Field label="What it was for">
              {id => (
                <AnimatedSelect
                  id={id}
                  className={select}
                  value={why}
                  onChange={e => {
                    setWhy(e.target.value === "other" ? "other" : "website");
                    setError(null);
                  }}
                >
                  <option value="website">The website</option>
                  <option value="other">Something else</option>
                </AnimatedSelect>
              )}
            </Field>
          </div>
          {why === "other" ? (
            <Field label="Say what it was">
              {id => (
                <Input
                  id={id}
                  value={note}
                  maxLength={500}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Logo design"
                />
              )}
            </Field>
          ) : null}
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy || !chosen || (why === "other" && note.trim().length < 3)
              }
              onClick={() =>
                send(
                  () =>
                    exclude({
                      taskId: row.taskId,
                      dealResponseId: deal.responseId,
                      paymentId: chosen,
                      reason: why,
                      note: why === "other" ? note.trim() : null,
                    }),
                  onDone,
                )
              }
            >
              {busy ? <Loader2 className={spin} aria-hidden /> : null}
              {busy ? "Leaving it out" : "Leave it out"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => open(null)}
            >
              Keep counting it
            </Button>
          </span>
        </div>
      ) : mode === null && row.rails.length > 0 ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => open("out")}>
            Leave a payment out of program money
          </Button>
        </div>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A card-only row (an Active client with no closer form): no plan to confirm
 * a part against, and the server takes no confirmation without a deal on a
 * card past onboarding, so a payment is logged from the sheet's own form.
 */
function CardOnlyPay({
  row,
  unlinked,
  onLogPayment,
}: {
  row: PendingRow;
  /** The CEO's signed deals with no card: one of them may be this client's. */
  unlinked: number;
  onLogPayment?: LogPaymentHandoff;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid min-w-0 content-start gap-3">
      <h4 className="text-sm font-medium">Record a payment</h4>
      <p className="text-sm text-muted-foreground">
        With no closer form on record there is no plan to confirm a part
        against. A payment they made is logged with its receipt from the billing
        sheet.
        {unlinked > 0
          ? " If one of the signed deals with no card is theirs, link it to this card and the plan shows here."
          : ""}
      </p>
      {onLogPayment ? (
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setError(null);
              const opened = onLogPayment({
                taskId: row.taskId,
                name: row.name,
                amount: row.nextPart?.usd ?? null,
                currency: "USD",
                note: "The card's next payment, from Pending payments",
              });
              if (!opened)
                setError(
                  `${row.name} is not in the billing sheet below yet, so its payment form cannot open. Reload the page, then try again.`,
                );
            }}
          >
            Log it as a payment
          </Button>
        </div>
      ) : (
        <p className="text-sm">
          Log it from this client's row in the billing sheet.
        </p>
      )}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function preferredPart(row: PendingRow): string | null {
  const p =
    row.parts.find(x => x.notSeen > 0 && x.kind !== "deposit") ??
    row.parts.find(x => x.notSeen > 0) ??
    row.parts.find(x => x.another > 0) ??
    row.parts.find(x => x.next);
  if (!p) return null;
  return `${p.kind}:${p.kind === "later" ? p.no : 0}`;
}

function RowPanel({
  id,
  api,
  row,
  view,
  notice,
  onLogPayment,
  onSetCardNext,
  onDone,
  onUnlinked,
}: {
  id: string;
  api: PendingApi;
  row: PendingRow;
  view: PendingView;
  notice: string | null;
  onLogPayment?: LogPaymentHandoff;
  onSetCardNext?: SetCardNext;
  onDone: (sentence: string) => void;
  /** Unlinking can take the row off the list, so its sentence shows on the section. */
  onUnlinked: (sentence: string) => void;
}) {
  const ceo = view.ceo;
  const formKey = row.confirmable
    .map(c => `${c.part}${c.partNo}:${c.emptyUsd}`)
    .join("|");
  // "Sources disagree" compares the card with the rails: without a money
  // read there are no rails to compare, so it is not said.
  const disagree = row.railsUsd === null ? null : row.disagree;
  const notes = disagree ? [disagree, ...row.notes] : row.notes;
  return (
    <section
      id={id}
      aria-label={`${row.name}: what is pending`}
      className="grid gap-5 border-t bg-muted/30 px-4 py-4 @2xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] @2xl:gap-8 @3xl:px-6"
    >
      <div className="grid min-w-0 content-start gap-5">
        <Parts row={row} today={view.today} />
        {row.cardOnly ? (
          <CardOnlyPay
            row={row}
            unlinked={ceo ? view.unlinked.length : 0}
            onLogPayment={onLogPayment}
          />
        ) : (
          <ConfirmForm
            key={formKey}
            api={api}
            name={row.name}
            taskId={row.taskId}
            dealResponseId={row.deal?.responseId ?? null}
            confirmable={row.confirmable}
            preferred={preferredPart(row)}
            signedOn={row.signedOn}
            today={view.today}
            ceo={ceo}
            onLogPayment={onLogPayment}
            onDone={onDone}
          />
        )}
        {notice ? (
          <p className="text-sm" role="status">
            {notice}
          </p>
        ) : null}
      </div>

      <div className="grid min-w-0 content-start gap-5 text-sm">
        {notes.length ? (
          <ul className="grid gap-1.5">
            {notes.map(n => (
              <li key={n} className="flex items-baseline gap-2">
                <span className="relative -top-px">
                  <Dot tone={n === disagree ? "warning" : "neutral"} />
                </span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <Confirmations
          api={api}
          taskId={row.taskId}
          list={row.confirmations}
          ceo={ceo}
          today={view.today}
          onDone={onDone}
        />
        <CardNext
          row={row}
          today={view.today}
          onSetCardNext={onSetCardNext}
          onDone={onDone}
        />
        {ceo ? <RowHints api={api} hints={row.hints} /> : null}
        {ceo ? <Unlink api={api} row={row} onDone={onUnlinked} /> : null}
        {ceo ? (
          <ProgramMoney
            api={api}
            row={row}
            today={view.today}
            onDone={onDone}
            onSection={onUnlinked}
          />
        ) : null}
        <div className="grid gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h4 className="font-medium">Where the numbers come from</h4>
            {row.url ? (
              <a
                href={row.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Open the ClickUp card
                <ArrowUpRight className="size-3" aria-hidden />
              </a>
            ) : null}
          </div>
          <ul className="grid gap-1.5">
            {row.sources.map(s => (
              <li
                key={s}
                className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"
              >
                <bdi>{s}</bdi>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function statusWords(r: PendingRow): string {
  if (r.inOnboarding) return `In onboarding · ${r.status ?? "no stage"}`;
  return r.status ?? "No status";
}

function RowItem({
  row,
  view,
  chipKey,
  open,
  onToggle,
  children,
}: {
  row: PendingRow;
  view: PendingView;
  chipKey: ChipKey;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = `pending-${row.taskId}`;
  return (
    <li className="border-b last:border-b-0" data-task={row.taskId}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={onToggle}
        className={`grid w-full gap-x-4 gap-y-1.5 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring @3xl:items-center @3xl:px-6 ${COLS} ${open ? "bg-muted/30" : ""}`}
      >
        <span className="flex min-w-0 items-start justify-between gap-3">
          <span className="grid min-w-0 gap-0.5">
            <bdi className="font-semibold [overflow-wrap:anywhere]">
              {row.name}
            </bdi>
            <span className="hidden truncate text-xs text-muted-foreground @3xl:block">
              {statusWords(row)}
            </span>
          </span>
          <span className="flex shrink-0 items-start gap-2 @3xl:hidden">
            <Amount row={row} chipKey={chipKey} today={view.today} />
            <ChevronDown
              className={`mt-0.5 size-4 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
              aria-hidden
            />
          </span>
        </span>

        <span className="grid min-w-0 gap-0.5">
          <span className="text-sm">{row.headline}</span>
          {/* How late, in words: the dot beside the amount is never the only sign. */}
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {row.dueLine}
            {row.when ? ` · ${row.when}` : ""}
          </span>
        </span>

        <span className="grid min-w-0 gap-1.5">
          {row.amountsKnown && row.parts.length ? (
            <Ribbon row={row} today={view.today} />
          ) : null}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
            <span className="tabular-nums">
              {row.amountsKnown
                ? `${usdText(row.railsUsd)} of ${usdText(row.contractUsd)} on a rail`
                : !row.deal
                  ? "no closer form, so no rail is read"
                  : row.railsUsd === null
                    ? "money ledger not read"
                    : `${usdText(row.railsUsd)} on a rail so far`}
            </span>
            {row.personUsd > 0 ? (
              <span className="tabular-nums">
                {usdText(row.personUsd)} confirmed
              </span>
            ) : null}
            {row.disagree && row.railsUsd !== null ? (
              <span className="inline-flex items-center gap-1.5">
                <Dot tone="warning" />
                sources disagree
              </span>
            ) : null}
          </span>
        </span>

        <span className="hidden @3xl:block">
          <Amount row={row} chipKey={chipKey} today={view.today} />
        </span>

        <ChevronDown
          className={`hidden size-4 text-muted-foreground transition-transform motion-reduce:transition-none @3xl:block ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? children : null}
    </li>
  );
}

// --- the folded groups -------------------------------------------------------

function Fold({
  id,
  title,
  ceoOnly,
  open,
  onToggle,
  children,
}: {
  id?: string;
  title: ReactNode;
  ceoOnly?: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-4 border-t">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring @3xl:px-6"
      >
        <span className="min-w-0">
          {title}
          {ceoOnly ? (
            <span className="block text-xs text-muted-foreground">
              Only the CEO sees this.
            </span>
          ) : null}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          {open ? "Hide" : "Show"}
          <ChevronDown
            className={`size-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </span>
      </button>
      {open ? children : null}
    </div>
  );
}

function SalesItem({
  api,
  row,
  view,
  onDone,
  notice,
}: {
  api: PendingApi;
  row: SalesRow;
  view: PendingView;
  onDone: (sentence: string) => void;
  notice: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-t first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring @3xl:px-6"
      >
        <span className="min-w-0">
          <bdi className="font-medium [overflow-wrap:anywhere]">{row.name}</bdi>
          <span className="block text-xs text-muted-foreground">
            Signed {dayText(row.signedOn, view.today)} · {row.planLabel}
            {row.contractUsd !== null ? ` ${usdText(row.contractUsd)}` : ""} ·{" "}
            {usdText(row.railsUsd)} on a rail
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-semibold tabular-nums">
            {usdText(row.leftUsd)}
          </span>
          <span className="block text-xs text-muted-foreground">left</span>
        </span>
      </button>
      {open ? (
        <div className="grid gap-5 border-t bg-muted/30 px-4 py-4 @2xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] @2xl:gap-8 @3xl:px-6">
          <div className="grid min-w-0 content-start gap-3">
            <ConfirmForm
              key={row.confirmable
                .map(c => `${c.part}${c.partNo}:${c.emptyUsd}`)
                .join("|")}
              api={api}
              name={row.name}
              taskId={row.taskId}
              dealResponseId={row.dealResponseId}
              confirmable={row.confirmable}
              preferred={null}
              signedOn={row.signedOn}
              today={view.today}
              ceo={view.ceo}
              logBlocked="This card is with the sales team, so the billing sheet does not list it. Log the transfer from its sheet row once the card is back in onboarding."
              onDone={onDone}
            />
            {notice ? (
              <p className="text-sm" role="status">
                {notice}
              </p>
            ) : null}
          </div>
          <div className="grid min-w-0 content-start gap-3 text-sm">
            <p className="text-muted-foreground">
              The card is with the sales team, so no part has a due day here.
              {row.url ? " " : ""}
              {row.url ? (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
                >
                  Open the ClickUp card
                  <ArrowUpRight className="size-3" aria-hidden />
                </a>
              ) : null}
            </p>
            <Confirmations
              api={api}
              taskId={row.taskId}
              list={row.confirmations}
              ceo={view.ceo}
              today={view.today}
              onDone={onDone}
            />
          </div>
        </div>
      ) : null}
    </li>
  );
}

function UnlinkedItem({
  api,
  item,
  view,
  linkable,
  onDone,
}: {
  api: PendingApi;
  item: UnlinkedRow;
  view: PendingView;
  /** The sheet's Active and onboarding cards: where a deal with no card belongs. */
  linkable?: LinkableCard[];
  onDone: (sentence: string) => void;
}) {
  const cards = useMemo(() => {
    const out: { taskId: string; name: string }[] = [];
    const seen = new Set<string>();
    const add = (taskId: string, name: string) => {
      if (seen.has(taskId)) return;
      seen.add(taskId);
      out.push({ taskId, name });
    };
    if (item.suggested) add(item.suggested.taskId, item.suggested.name);
    // The deal belongs on a card that has no deal of its own, which is never
    // on the list, so the choices are the sheet's cards; the listed rows
    // stand in only until the sheet has loaded.
    const pool = linkable ?? [...view.rows, ...view.quiet.rows];
    for (const c of [...pool].sort((a, b) => a.name.localeCompare(b.name)))
      add(c.taskId, c.name);
    return out;
  }, [item, view, linkable]);
  const [pick, setPick] = useState(item.suggested?.taskId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = item.preview;
  return (
    <li className="grid gap-3 border-t px-4 py-3 first:border-t-0 @3xl:px-6">
      <div className="grid gap-1 text-sm">
        <bdi className="font-medium [overflow-wrap:anywhere]">
          {item.deal.business ?? "A signed deal"}
        </bdi>
        <span className="text-muted-foreground">{item.line}</span>
        {preview ? (
          <span className="text-xs text-muted-foreground">
            Once linked: {preview.headline}
            {preview.notSeenUsd !== null
              ? `, ${usdText(preview.notSeenUsd)} not seen.`
              : "."}
          </span>
        ) : null}
        {item.hints.length ? (
          <span className="text-xs text-muted-foreground">
            {plural(item.hints.length, "untied payment")} could be this deal's.
            Tie the right ones to the deal on Transactions, not to the card, so
            the money credits the closer.
          </span>
        ) : null}
      </div>
      {api.link ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="The client's card" className="w-full sm:w-72">
            {id => (
              <AnimatedSelect
                id={id}
                className={select}
                value={pick}
                onChange={e => {
                  setPick(e.target.value);
                  setError(null);
                }}
              >
                <option value="">Which card is it?</option>
                {cards.map(c => (
                  <option key={c.taskId} value={c.taskId}>
                    {c.name}
                  </option>
                ))}
              </AnimatedSelect>
            )}
          </Field>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !pick}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                onDone(
                  (await api.link?.({
                    dealResponseId: item.deal.responseId,
                    taskId: pick,
                  })) ?? "Linked.",
                );
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className={spin} aria-hidden /> : null}
            {busy ? "Linking" : "Link to a card"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Link it from the CEO cockpit's Billing tab.
        </p>
      )}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function PossibleMoney({ api, view }: { api: PendingApi; view: PendingView }) {
  const [all, setAll] = useState(false);
  const list: PossiblePayment[] = view.possibleMoney;
  const shown = all ? list : list.slice(0, 6);
  return (
    <div className="grid gap-3 px-4 pb-4 @3xl:px-6">
      <p className="max-w-2xl text-xs text-muted-foreground">
        Untied payments that fit a part with room left, of a listed client or a
        deal with no card, best first. None of them counts as money until you
        tie it to the deal (not the card, so the closer is credited).
      </p>
      {view.staleConfirmations.length ? (
        <ul className="grid gap-1.5">
          {view.staleConfirmations.map(s => (
            <li
              key={s.confirmation.id}
              className="flex items-baseline gap-2 text-sm"
            >
              <span className="relative top-px">
                <Swatch state="person" />
              </span>
              <span className="min-w-0">
                <bdi className="font-medium">{s.clientName}</bdi>: {s.line}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="grid gap-3">
        {shown.map(p => {
          const [best, ...rest] = p.candidates;
          return (
            <li
              key={p.paymentId}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-sm"
            >
              <span className="min-w-0">
                <span className="tabular-nums">{paymentWords(p)}</span>
                {p.payerName ? (
                  <>
                    {" "}
                    from <bdi>{p.payerName}</bdi>
                  </>
                ) : null}
                {best ? (
                  <span className="block text-xs text-muted-foreground">
                    Could be <bdi>{best.clientName}</bdi>, {best.partLabel} (
                    {best.why.toLowerCase()})
                    {rest.length
                      ? `, or ${plural(rest.length, "other part")}`
                      : ""}
                  </span>
                ) : null}
              </span>
              <TieButton api={api} paymentId={p.paymentId} />
            </li>
          );
        })}
      </ul>
      {list.length > 6 ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setAll(a => !a)}>
            {all ? "Show the first 6" : `Show all ${list.length}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// --- the section -----------------------------------------------------------

export function PendingPayments({
  api,
  cards,
  onLogPayment,
  onSetCardNext,
  onShowLate,
  onChanged,
  reloadKey = 0,
}: {
  api: PendingApi;
  /** The cards a deal with no card can be linked to (CEO); the sheet's own list. */
  cards?: LinkableCard[];
  onLogPayment?: LogPaymentHandoff;
  onSetCardNext?: SetCardNext;
  /** Opens the sheet's Late view (the footnote's clients are there). */
  onShowLate?: () => void;
  /** Something was written: the sheet's log reads again. */
  onChanged?: () => void;
  /** Bumped by the sheet after it saves for a client (a payment it logged, a date it moved): the section reads again. */
  reloadKey?: number;
}) {
  const headingId = useId();
  const [view, setView] = useState<PendingView | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chipKey, setChipKey] = useState<ChipKey>("notSeen");
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [notice, setNotice] = useState<{ key: string; text: string } | null>(
    null,
  );
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  // Where each row sat last time, so an open row keeps its place when a
  // confirmation moves it to another chip or down the order.
  const placed = useRef<{ chip: ChipKey; order: string[] } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setView(await api.read());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  // The sheet below saved something (a payment logged, a date moved): read
  // again, so a logged transfer moves to "Another source says paid" at once.
  const seenKey = useRef(reloadKey);
  useEffect(() => {
    if (reloadKey === seenKey.current) return;
    seenKey.current = reloadKey;
    void load();
  }, [reloadKey, load]);

  const done = (key: string) => (sentence: string) => {
    setNotice({ key, text: sentence });
    void load();
    onChanged?.();
  };
  const fold = (k: string) => setFolds(f => ({ ...f, [k]: !f[k] }));

  const title = (
    <h3 id={headingId} className="font-semibold">
      Pending payments
    </h3>
  );

  if (!view)
    return (
      <section
        aria-labelledby={headingId}
        className="rounded-xl border bg-card p-4 sm:p-6"
      >
        {title}
        {error ? (
          <div className="mt-2 grid gap-3">
            <p className="text-sm text-destructive" role="alert">
              Pending payments did not load: {error.replace(/\.?$/, ".")} The
              billing sheet below still works.
            </p>
            <div>
              <Button size="sm" variant="outline" onClick={() => load()}>
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className={`size-4 ${spin}`} aria-hidden />
            Reading pending payments
          </p>
        )}
      </section>
    );

  const ceo = view.ceo;
  const inChip = view.rows.filter(r => r.chips.includes(chipKey));
  // The open row stays where it was, so a decision never makes it vanish
  // or jump mid-read, even when it now belongs under another chip.
  const natural = inChip.filter((_, i) => all || i < SHOWN);
  let visible = natural;
  const openRow = open ? view.rows.find(r => r.taskId === open) : undefined;
  if (openRow) {
    const rest = natural.filter(r => r !== openRow);
    const before =
      placed.current?.chip === chipKey
        ? placed.current.order.indexOf(openRow.taskId)
        : -1;
    const own = natural.indexOf(openRow);
    const at =
      before >= 0
        ? Math.min(before, rest.length)
        : own >= 0
          ? own
          : rest.length;
    visible = [...rest.slice(0, at), openRow, ...rest.slice(at)];
  }
  placed.current = { chip: chipKey, order: visible.map(r => r.taskId) };
  const sales = ceo ? view.backWithSales : null;
  const unlinked = ceo ? view.unlinked : [];
  const nothingAtAll =
    view.rows.length === 0 &&
    view.quiet.rows.length === 0 &&
    !sales?.rows.length &&
    unlinked.length === 0;
  const chipsShown = view.chips.filter(
    c => c.key === "notSeen" || c.key === chipKey || c.count > 0,
  );
  const clock = kuwaitClock(view.asOf.money);

  const rowPanel = (r: PendingRow) => (
    <RowPanel
      id={`pending-${r.taskId}`}
      api={api}
      row={r}
      view={view}
      notice={notice?.key === r.taskId ? notice.text : null}
      onLogPayment={onLogPayment}
      onSetCardNext={onSetCardNext}
      onDone={done(r.taskId)}
      onUnlinked={done("section")}
    />
  );

  return (
    <section
      aria-labelledby={headingId}
      className="@container overflow-hidden rounded-xl border bg-card"
      data-pending-payments
    >
      <div className="grid gap-4 p-4 @3xl:px-6 @3xl:pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title}
            <p className="text-sm text-muted-foreground">
              Signed clients who have not finished paying, part by part. Paid
              means a payment rail shows the money.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {clock ? (
              <span className="hidden whitespace-nowrap tabular-nums @md:inline">
                Money read {clock}
              </span>
            ) : null}
            <Button
              size="icon"
              variant="ghost"
              disabled={busy}
              onClick={() => load()}
              aria-label="Read pending payments again"
            >
              <RefreshCw className={busy ? spin : ""} aria-hidden />
            </Button>
          </div>
        </div>

        {nothingAtAll ? null : <Figures view={view} />}

        {notice?.key === "section" ? (
          <p className="text-sm" role="status">
            {notice.text}
          </p>
        ) : null}
        {[view.staleLine, ...view.staleLines]
          .filter((l): l is string => Boolean(l))
          .map(l => (
            <p key={l} className="flex items-start gap-2 text-sm" role="status">
              <span className="mt-1.5">
                <Dot tone="warning" />
              </span>
              {l}
            </p>
          ))}
        {unlinked.length ? (
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-sm">
            <p className="flex min-w-0 items-start gap-2">
              <span className="mt-1.5">
                <Dot tone="warning" />
              </span>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {plural(unlinked.length, "signed deal")}{" "}
                {unlinked.length === 1 ? "has" : "have"} no client card:{" "}
                {unlinked.map((u, i) => (
                  <span key={u.deal.responseId}>
                    {i ? ", " : ""}
                    <bdi>{u.deal.business ?? "a signed deal"}</bdi>
                  </span>
                ))}
                . Until you link {unlinked.length === 1 ? "it" : "them"} to a
                card, a success manager sees no balance for that client.
              </span>
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              onClick={() => {
                setFolds(f => ({ ...f, unlinked: true }));
                const still =
                  typeof window !== "undefined" &&
                  window.matchMedia?.("(prefers-reduced-motion: reduce)")
                    .matches;
                requestAnimationFrame(() =>
                  document
                    .getElementById(`${headingId}-unlinked`)
                    ?.scrollIntoView?.({
                      behavior: still ? "auto" : "smooth",
                      block: "nearest",
                    }),
                );
              }}
            >
              {unlinked.length === 1 ? "Show the deal" : "Show the deals"}
            </Button>
          </div>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            Pending payments did not load again: {error.replace(/\.?$/, ".")}{" "}
            What shows is from the last read.
          </p>
        ) : null}
      </div>

      {nothingAtAll ? (
        <div className="grid gap-1 border-t px-4 py-10 text-center">
          <p className="text-sm font-medium">
            Every signed client has finished paying.
          </p>
          <p className="text-sm text-muted-foreground">
            New clients show here from sign-up until their onboarding payment
            lands on a rail.
          </p>
        </div>
      ) : (
        <>
          <div className="border-t px-4 py-3 @3xl:px-6">
            <div
              className="-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] @3xl:mx-0 @3xl:flex-wrap @3xl:overflow-visible @3xl:px-0 [&::-webkit-scrollbar]:hidden"
              role="group"
              aria-label="Which clients to show"
            >
              {chipsShown.map(c => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={chipKey === c.key}
                  onClick={() => {
                    setChipKey(c.key);
                    setAll(false);
                    // An open row stays in place when a decision moves it
                    // (same chip); a chip picked by hand shows only its own.
                    setOpen(null);
                  }}
                  className={chip(chipKey === c.key)}
                >
                  {c.label}
                  <span className="ml-1.5 tabular-nums opacity-60">
                    {c.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div
            className={`hidden gap-4 border-y px-6 py-2 text-xs text-muted-foreground @3xl:grid ${COLS}`}
            aria-hidden
          >
            <span>Client</span>
            <span>Plan · part</span>
            <span>The contract</span>
            <span className="text-right">{COLUMN_WORD[chipKey]}</span>
            <span />
          </div>

          {visible.length ? (
            <ul className="border-t @3xl:border-t-0">
              {visible.map(r => (
                <RowItem
                  key={r.taskId}
                  row={r}
                  view={view}
                  chipKey={chipKey}
                  open={open === r.taskId}
                  onToggle={() => setOpen(open === r.taskId ? null : r.taskId)}
                >
                  {rowPanel(r)}
                </RowItem>
              ))}
            </ul>
          ) : (
            <div className="grid gap-1 border-t px-4 py-8 text-center">
              <p className="text-sm font-medium">
                {chipKey === "notSeen" || chipKey === "onboarding"
                  ? view.nothingDueLine
                  : "Nobody here right now."}
              </p>
              <p className="text-sm text-muted-foreground">
                {chipKey === "onboarding"
                  ? "A new client shows here from sign-up until the onboarding payment lands on a rail."
                  : "The other chips show who is next and what another source says."}
              </p>
            </div>
          )}

          {inChip.length > SHOWN ? (
            <div className="border-t px-4 py-2 @3xl:px-6">
              <Button size="sm" variant="ghost" onClick={() => setAll(a => !a)}>
                {all ? `Show the first ${SHOWN}` : `Show all ${inChip.length}`}
              </Button>
            </div>
          ) : null}

          {view.quiet.rows.length && view.quiet.line ? (
            <Fold
              title={view.quiet.line}
              open={Boolean(folds.quiet)}
              onToggle={() => fold("quiet")}
            >
              <ul className="border-t">
                {view.quiet.rows.map(r => (
                  <RowItem
                    key={r.taskId}
                    row={r}
                    view={view}
                    chipKey={chipKey}
                    open={open === r.taskId}
                    onToggle={() =>
                      setOpen(open === r.taskId ? null : r.taskId)
                    }
                  >
                    {rowPanel(r)}
                  </RowItem>
                ))}
              </ul>
            </Fold>
          ) : null}

          {sales?.rows.length ? (
            <Fold
              title={sales.line}
              ceoOnly
              open={Boolean(folds.sales)}
              onToggle={() => fold("sales")}
            >
              <ul className="border-t">
                {sales.rows.map(s => (
                  <SalesItem
                    key={s.taskId}
                    api={api}
                    row={s}
                    view={view}
                    notice={
                      notice?.key === `sales:${s.taskId}` ? notice.text : null
                    }
                    onDone={done(`sales:${s.taskId}`)}
                  />
                ))}
              </ul>
            </Fold>
          ) : null}

          {unlinked.length ? (
            <Fold
              id={`${headingId}-unlinked`}
              title={
                <>
                  {plural(unlinked.length, "signed deal")}{" "}
                  {unlinked.length === 1 ? "has" : "have"} no client card:{" "}
                  {unlinked.map((u, i) => (
                    <span key={u.deal.responseId}>
                      {i ? ", " : ""}
                      <bdi>{u.deal.business ?? "a signed deal"}</bdi>
                    </span>
                  ))}
                </>
              }
              ceoOnly
              open={Boolean(folds.unlinked)}
              onToggle={() => fold("unlinked")}
            >
              <ul className="border-t">
                {unlinked.map(u => (
                  <UnlinkedItem
                    key={u.deal.responseId}
                    api={api}
                    item={u}
                    view={view}
                    linkable={cards}
                    onDone={done("section")}
                  />
                ))}
              </ul>
            </Fold>
          ) : null}

          {ceo &&
          (view.possibleMoney.length || view.staleConfirmations.length) ? (
            <Fold
              title={`Possible money: ${plural(view.possibleMoney.length, "untied payment")} could be these clients' parts${
                view.staleConfirmations.length
                  ? `, and ${plural(view.staleConfirmations.length, "confirmation")} no rail has proven in 7 days`
                  : ""
              }`}
              ceoOnly
              open={Boolean(folds.money)}
              onToggle={() => fold("money")}
            >
              <PossibleMoney api={api} view={view} />
            </Fold>
          ) : null}
        </>
      )}

      {view.finished.length ? (
        <p className="border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere] @3xl:px-6">
          Finished on the rails:{" "}
          {[...view.finished]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((f, i) => (
              <span key={f.taskId}>
                {i ? ", " : ""}
                <bdi>{f.name}</bdi>
              </span>
            ))}
          .
        </p>
      ) : null}

      {view.footnote ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-3 text-xs text-muted-foreground @3xl:px-6">
          <p className="max-w-3xl leading-relaxed">{view.footnote.line}</p>
          {onShowLate ? (
            <Button size="sm" variant="ghost" onClick={onShowLate}>
              Open the Late view
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
