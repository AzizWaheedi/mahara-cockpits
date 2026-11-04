import { ArrowUpRight, Loader2, RefreshCw } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { RequestForm } from "@/components/tasks/RequestForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dayText, usdText } from "@/lib/billingBalances";
import {
  type CheckResult,
  type CheckVerdict,
  type CheckWaiting,
  checkManualPayment,
  checkProblem,
  checksDoorOpen,
  railWords,
  toCheckWaiting,
  waitingWords,
} from "@/lib/paymentChecks";
import { readRequestTypes } from "@/lib/requestsClient";
import { useTaskSeat } from "@/lib/taskSeat";

/*
 * Hallmark · component: section list · genre: modern-minimal · theme: the cockpit's own
 * states: default · hover · focus · active · disabled · loading · error · success
 * pre-emit critique: P4 H4 E4 S5 R5 V4
 *
 * Checks waiting (docs/forms/WAVE12-CONTRACT.md 4.2.5 and 5.7): the payments
 * someone logged by hand that finance or the CEO has not checked against the
 * bank yet (supabase/migrations/20261101n_checked_money.sql). Until a check,
 * a payment is not cash, pay or LTV, and Pending payments reads its part as
 * "Receipt in, not checked". The same file in the CEO cockpit and the client
 * success cockpit (scripts/check-shared.sh holds it to that).
 *
 * Design plan (contract section 5, as built):
 * - Subject. Finance, or the CEO, with the bank statement open beside the
 *   cockpit: is this money really in? One decision per row, said with the
 *   reference that proves it. A success manager reads the same rows for
 *   their own clients and gets no control.
 * - Tokens. No new palette: the billing sheet's roles (--b-warning amber for
 *   waiting, --primary teal for checked, the destructive red only for a
 *   refusal), the app's --muted and --border. Geist for words, Geist Mono for
 *   amounts, days and references. Client names in <bdi>.
 * - Layout. One card like Pending payments beside it (or bare inside the CEO's
 *   own SectionCard): a title row with the count, then one row per payment,
 *   oldest first. Each row is three lines at any width: client and amount;
 *   when, how, which reference and how long it has waited; the actions. A
 *   decision opens a small inline form under its row, never a dialog.
 * - Signature: the ring before each row, the same ring as the after-send
 *   trail. Amber while it waits; filled teal once Checked; an empty grey
 *   ring once Rejected. The ring changes in place, the row stays until the
 *   next read, so the person sees the decision land.
 * - Against the template. Not a table of pills with "Approve"/"Deny": the
 *   buttons say what happens (Check, Reject), the form asks for the proof
 *   the check needs, and the result reads "Checked", never "Approved".
 */

/**
 * Waves 5-6 (WAVE56-CONTRACT.md 4.10, 5.6): a row may carry the client's
 * receipt (sent through the bank receipt form), whether the client can be
 * asked for one, and a near match with another logged transfer.
 */
export type ClientReceipt = {
  responseId: string;
  field: string;
  mime: string | null;
  at: string | null;
};
export type CheckRow = CheckWaiting & {
  receipt: ClientReceipt | null;
  askable: boolean;
  nearMatch: {
    day: string | null;
    amount: number | null;
    currency: string | null;
  } | null;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const numOr = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v))
    ? null
    : Number(v);

/** One row of cockpit_manual_payments_to_check with the waves 5-6 additions, read defensively. */
export function toCheckRow(raw: unknown): CheckRow {
  const base = toCheckWaiting(raw);
  const r = (raw ?? {}) as Record<string, unknown>;
  const rec =
    r.receipt && typeof r.receipt === "object"
      ? (r.receipt as Record<string, unknown>)
      : null;
  const near =
    r.nearMatch && typeof r.nearMatch === "object"
      ? (r.nearMatch as Record<string, unknown>)
      : null;
  return {
    ...base,
    receipt:
      rec && str(rec.responseId)
        ? {
            responseId: str(rec.responseId) as string,
            field: str(rec.field) ?? "receipt",
            mime: str(rec.mime),
            at: str(rec.at ?? rec.addedAt),
          }
        : null,
    askable: r.askable === true,
    nearMatch: near
      ? {
          day: str(near.day ?? near.paidOn),
          amount: numOr(near.amount),
          currency: str(near.currency),
        }
      : null,
  };
}

/** A HEIC photo: desktop browsers cannot show one, so it is downloaded to view (5.6). */
export const isHeic = (mime: string | null | undefined) =>
  /heic|heif/i.test(String(mime ?? ""));

export type ChecksApi = {
  /** cockpit_form_doors().checks: false until 20261101n is live. */
  door: () => Promise<boolean>;
  /** The rows; an older list without the waves 5-6 fields reads as no receipt, not askable. */
  list: () => Promise<
    (CheckWaiting &
      Partial<Pick<CheckRow, "receipt" | "askable" | "nearMatch">>)[]
  >;
  /** cockpit-forms-api `file.url`: a 5-minute signed link to a client's receipt (waves 5-6). */
  receiptUrl?: (responseId: string, field: string) => Promise<string>;
  check: (p: {
    id: string;
    verdict: CheckVerdict;
    ref: string | null;
    statementLineId: string | null;
  }) => Promise<CheckResult>;
  /** Whether the payment_receipt_check request type exists (after deploy step D-R1). */
  ticketType: () => Promise<boolean>;
};

export type ChecksWaitingProps = {
  /** Finance and the CEO: Check and Reject. Anyone else reads the list. */
  canCheck: boolean;
  /** Draw the section's own card; false inside a card that already carries the title. */
  framed?: boolean;
  /** After a check or a rejection lands, so the screen around it can read again. */
  onChecked?: (r: CheckResult) => void;
  /**
   * Ask the client for the receipt (the Send panel on the bank receipt,
   * origin billing, context manualPaymentId); absent while the receipt
   * form is not live or the cockpit has no Send panel.
   */
  onAskReceipt?: (row: CheckRow) => void;
};

const TICKET_TYPE = "payment_receipt_check";
const spin = "animate-spin motion-reduce:animate-none";
const label = "text-xs font-medium text-muted-foreground";

function kuwaitToday(now = Date.now()): string {
  return new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
}

/** "200.000 KWD" in the currency it was typed in. */
function typed(amount: number, currency: string): string {
  return currency === "USD"
    ? usdText(amount)
    : `${amount.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ${currency}`;
}

function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return (
    raw.trim().slice(0, 300) ||
    "That did not save, so nothing changed. Try again in a minute."
  );
}

/** The ring before a row: amber waiting, teal checked, grey rejected. */
function Ring({ state }: { state: "waiting" | CheckVerdict }) {
  return (
    <span
      aria-hidden
      data-ring={state}
      className="mt-1 inline-block size-2.5 shrink-0 rounded-full border-2 transition-colors duration-150 motion-reduce:transition-none"
      style={
        state === "checked"
          ? { borderColor: "var(--primary)", background: "var(--primary)" }
          : state === "rejected"
            ? {
                borderColor:
                  "color-mix(in srgb, currentColor 35%, transparent)",
                background: "transparent",
              }
            : {
                borderColor: "var(--b-warning, var(--warning))",
                background: "transparent",
              }
      }
    />
  );
}

/** The wiring each cockpit mounts: its own signed-in client and its own request form. */
export function ChecksWaiting(props: ChecksWaitingProps) {
  const seat = useTaskSeat();
  const client = seat.client;
  const api = useMemo<ChecksApi | null>(
    () =>
      client
        ? {
            door: () => checksDoorOpen(client),
            list: async () => {
              const { data, error } = await client.rpc(
                "cockpit_manual_payments_to_check",
              );
              if (error)
                throw new Error(
                  String(error.message ?? "").trim() ||
                    "The list did not come back. Try again in a minute.",
                );
              return (Array.isArray(data) ? data : []).map(toCheckRow);
            },
            receiptUrl: async (responseId, field) => {
              const { data, error } = await client.functions.invoke(
                "cockpit-forms-api",
                { body: { op: "file.url", responseId, field } },
              );
              const url =
                data && typeof (data as { url?: unknown }).url === "string"
                  ? (data as { url: string }).url
                  : null;
              if (error || !url)
                throw new Error(
                  (data as { error?: string } | null)?.error ??
                    "The receipt link did not come back. Try again in a minute.",
                );
              return url;
            },
            check: p => checkManualPayment(client, p),
            ticketType: async () => {
              try {
                const read = await readRequestTypes(client);
                return read.types.some(t => t.key === TICKET_TYPE && t.enabled);
              } catch {
                return false;
              }
            },
          }
        : null,
    [client],
  );
  if (!api) return null;
  return (
    <ChecksWaitingView
      {...props}
      api={api}
      renderTicket={row => (
        <RequestForm
          source="client_page"
          presetClient={
            row.taskId
              ? { taskId: row.taskId, name: row.clientName }
              : undefined
          }
          presetType={TICKET_TYPE}
          presetDetails={`Check ${typed(row.amount, row.currency)}${row.currency === "USD" ? "" : ` (${usdText(row.amountUsd)})`} from ${row.clientName}, received ${row.day} by ${railWords(row.rail).toLowerCase()}${row.reference ? `, reference ${row.reference}` : ""}, against the bank statement.`}
          compact
        />
      )}
    />
  );
}

type Done = { id: string; state: CheckVerdict; ref: string | null };

/** The list itself, over any api: the tests drive this with a made-up one. */
export function ChecksWaitingView({
  api,
  canCheck,
  framed = true,
  onChecked,
  onAskReceipt,
  renderTicket,
}: ChecksWaitingProps & {
  api: ChecksApi;
  renderTicket?: (row: CheckWaiting) => ReactNode;
}) {
  const headingId = useId();
  const [door, setDoor] = useState<boolean | null>(null);
  const [rows, setRows] = useState<CheckRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState(false);
  const [done, setDone] = useState<Record<string, Done>>({});
  const today = kuwaitToday();

  // Whether a ticket can render, not which function draws it: a caller passing a fresh renderTicket each render
  // must not read the list again each render.
  const wantsTicket = Boolean(renderTicket);
  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const open = await api.door();
      setDoor(open);
      if (!open) return;
      const [list, hasTicket] = await Promise.all([
        api.list(),
        wantsTicket ? api.ticketType() : Promise.resolve(false),
      ]);
      setRows(
        list.map(r => ({
          ...r,
          receipt: r.receipt ?? null,
          askable: r.askable === true,
          nearMatch: r.nearMatch ?? null,
        })),
      );
      setTicket(hasTicket);
      setDone({});
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [api, wantsTicket]);
  useEffect(() => {
    void load();
  }, [load]);

  // A success manager sees nothing until there is something of theirs to read.
  if (!canCheck && (door === false || (rows !== null && rows.length === 0)))
    return null;

  const waiting = rows?.filter(r => !done[r.id]).length ?? 0;
  const head = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        {framed ? (
          <h3 id={headingId} className="font-semibold">
            Checks waiting
            {rows && waiting > 0 ? (
              <span className="ml-2 font-mono text-sm font-normal tabular-nums text-muted-foreground">
                {waiting}
              </span>
            ) : null}
          </h3>
        ) : null}
        <p className="mt-1 text-sm text-muted-foreground">
          {canCheck
            ? "Payments logged by hand. Check each one against the bank: until then it is not cash, pay or LTV."
            : "Payments logged by hand that finance has not checked against the bank yet. They are not counted as paid until then."}
        </p>
      </div>
      {door ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => load()}
          disabled={busy}
          aria-label="Read the list again"
        >
          <RefreshCw className={busy ? spin : undefined} aria-hidden />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      ) : null}
    </div>
  );

  let body: ReactNode;
  if (error)
    body = (
      <div className="grid gap-3">
        <p className="text-sm text-destructive" role="alert">
          The list did not load: {error.replace(/\.?$/, ".")}
        </p>
        <div>
          <Button size="sm" variant="outline" onClick={() => load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  else if (door === null || (door && rows === null))
    body = (
      <LoadingSkeleton
        variant="list"
        label="Loading the payments waiting on a check"
        rows={4}
      />
    );
  else if (!door)
    body = (
      <p className="text-sm text-muted-foreground">
        Checks waiting opens here once the check rule is live on the database.
      </p>
    );
  else if (!rows?.length)
    body = (
      <p className="text-sm text-muted-foreground">
        Nothing waiting on a check.
      </p>
    );
  else
    body = (
      <ol className="grid divide-y">
        {rows.map(r => (
          <CheckRow
            key={r.id}
            row={r}
            today={today}
            canCheck={canCheck}
            done={done[r.id] ?? null}
            ticket={ticket && renderTicket ? renderTicket : undefined}
            onDone={(mark, result) => {
              setDone(d => ({ ...d, [r.id]: mark }));
              onChecked?.(result);
            }}
            check={api.check}
            receiptUrl={api.receiptUrl}
            onAskReceipt={onAskReceipt}
          />
        ))}
      </ol>
    );

  const inner = (
    <div className="grid gap-4">
      {head}
      {body}
    </div>
  );
  return framed ? (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border bg-card p-4 sm:p-6"
      data-checks-waiting
    >
      {inner}
    </section>
  ) : (
    <div data-checks-waiting role="region" aria-label="Checks waiting">
      {inner}
    </div>
  );
}

function CheckRow({
  row,
  today,
  canCheck,
  done,
  ticket,
  onDone,
  check,
  receiptUrl,
  onAskReceipt,
}: {
  row: CheckRow;
  today: string;
  canCheck: boolean;
  done: Done | null;
  ticket?: (row: CheckWaiting) => ReactNode;
  onDone: (mark: Done, result: CheckResult) => void;
  check: ChecksApi["check"];
  receiptUrl?: ChecksApi["receiptUrl"];
  onAskReceipt?: (row: CheckRow) => void;
}) {
  const [opening, setOpening] = useState(false);
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  const openReceipt = async () => {
    if (!row.receipt || !receiptUrl) return;
    setOpening(true);
    setLinkProblem(null);
    // The tab opens on the press (a pop-up blocker allows it), then takes the link.
    const tab =
      typeof window !== "undefined" ? window.open("", "_blank") : null;
    try {
      const url = await receiptUrl(row.receipt.responseId, row.receipt.field);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.location.assign(url);
    } catch (e) {
      tab?.close();
      setLinkProblem(errorText(e));
    } finally {
      setOpening(false);
    }
  };
  const [form, setForm] = useState<CheckVerdict | null>(null);
  const [ref, setRef] = useState("");
  const [line, setLine] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [showTicket, setShowTicket] = useState(false);
  const refId = useId();
  const lineId = useId();

  const open = (v: CheckVerdict) => {
    setForm(f => (f === v ? null : v));
    setProblem(null);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const local = checkProblem(form, ref, line);
    if (local) {
      setProblem(local);
      return;
    }
    setSending(true);
    setProblem(null);
    try {
      const r = await check({
        id: row.id,
        verdict: form,
        ref: ref.trim() || null,
        statementLineId: line.trim() || null,
      });
      onDone({ id: row.id, state: r.state, ref: ref.trim() || null }, r);
      setForm(null);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setSending(false);
    }
  };

  const meta = [
    `Received ${dayText(row.day, today)}`,
    railWords(row.rail),
    row.reference ? `ref ${row.reference}` : "no reference given",
    `logged by ${row.addedBy.charAt(0).toLowerCase()}${row.addedBy.slice(1)}`,
    waitingWords(row.daysWaiting),
  ];

  return (
    <li
      className="grid grid-cols-[0.625rem_minmax(0,1fr)] gap-x-3 py-3 first:pt-0 last:pb-0"
      data-check-row={row.id}
    >
      <Ring state={done ? done.state : "waiting"} />
      <div className="grid min-w-0 gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="min-w-0 truncate font-medium">
            {row.kind === "refund" ? (
              <span className="mr-1.5 text-xs font-normal text-muted-foreground">
                Refund
              </span>
            ) : null}
            <bdi>{row.clientName}</bdi>
          </span>
          <span className="shrink-0 text-right font-mono text-sm tabular-nums">
            {typed(row.amount, row.currency)}
            {row.currency === "USD" ? null : (
              <span className="ml-2 text-xs text-muted-foreground">
                {usdText(row.amountUsd)}
              </span>
            )}
          </span>
        </div>
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-mono">{meta.join(" · ")}</span>
          {row.evidenceUrl && /^https:\/\//.test(row.evidenceUrl) ? (
            <a
              href={row.evidenceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Receipt
              <ArrowUpRight className="size-3" aria-hidden />
            </a>
          ) : null}
        </p>
        {row.receipt ? (
          <p
            className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs"
            data-client-receipt
          >
            <span className="text-muted-foreground">
              Receipt from the client ·{" "}
              {dayText(row.receipt.at?.slice(0, 10) ?? null, today) ||
                "day not recorded"}
            </span>
            {receiptUrl ? (
              <button
                type="button"
                onClick={() => void openReceipt()}
                disabled={opening}
                className="inline-flex items-center gap-0.5 rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                {opening ? (
                  <Loader2 className={`size-3 ${spin}`} aria-hidden />
                ) : null}
                {isHeic(row.receipt.mime)
                  ? "Download to view"
                  : "View the receipt"}
                <ArrowUpRight className="size-3" aria-hidden />
              </button>
            ) : null}
          </p>
        ) : null}
        {row.nearMatch ? (
          <p className="text-xs" data-near-match>
            May be the same transfer as{" "}
            {dayText(row.nearMatch.day, today) || "another day"}{" "}
            {row.nearMatch.amount !== null && row.nearMatch.currency
              ? typed(row.nearMatch.amount, row.nearMatch.currency)
              : "an amount not recorded"}
          </p>
        ) : null}
        {linkProblem ? (
          <p className="text-xs text-destructive" role="alert">
            {linkProblem}
          </p>
        ) : null}
        {!row.receipt && row.askable && onAskReceipt && !done ? (
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onAskReceipt(row)}
              data-ask-receipt
            >
              Ask the client for the receipt
            </Button>
          </div>
        ) : null}

        {done ? (
          <p className="text-sm" role="status">
            <span
              className={
                done.state === "checked"
                  ? "font-medium text-foreground"
                  : "font-medium text-muted-foreground"
              }
            >
              {done.state === "checked" ? "Checked" : "Rejected"}
            </span>
            <span className="text-muted-foreground">
              {done.state === "checked"
                ? `${done.ref ? ` against ${done.ref}` : ""}. It counts from the next money refresh.`
                : `${done.ref ? `: ${done.ref}` : ""}. It counts nowhere.`}
            </span>
          </p>
        ) : canCheck || ticket ? (
          <div className="flex flex-wrap items-center gap-2">
            {canCheck ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  aria-expanded={form === "checked"}
                  onClick={() => open("checked")}
                >
                  Check
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-expanded={form === "rejected"}
                  onClick={() => open("rejected")}
                >
                  Reject
                </Button>
              </>
            ) : null}
            {ticket ? (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={showTicket}
                onClick={() => setShowTicket(s => !s)}
              >
                Open the receipt check
              </Button>
            ) : null}
          </div>
        ) : null}

        {form && !done ? (
          <form
            onSubmit={submit}
            className="grid gap-3 rounded-lg border bg-muted/30 p-3"
            aria-label={
              form === "checked" ? "Check this payment" : "Reject this payment"
            }
          >
            {form === "checked" ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid min-w-0 gap-1">
                    <label htmlFor={refId} className={label}>
                      Bank reference
                    </label>
                    <Input
                      id={refId}
                      value={ref}
                      onChange={e => setRef(e.target.value)}
                      placeholder="FT26110042"
                      className="font-mono"
                      autoComplete="off"
                      autoFocus
                      maxLength={200}
                    />
                  </div>
                  <div className="grid min-w-0 gap-1">
                    <label htmlFor={lineId} className={label}>
                      Statement line
                    </label>
                    <Input
                      id={lineId}
                      value={line}
                      onChange={e => setLine(e.target.value)}
                      placeholder="Line id on an uploaded statement"
                      className="font-mono"
                      autoComplete="off"
                      inputMode="numeric"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Name one of them, so the check reads back.
                </p>
              </>
            ) : (
              <div className="grid min-w-0 gap-1">
                <label htmlFor={refId} className={label}>
                  Why is it rejected?
                </label>
                <Input
                  id={refId}
                  value={ref}
                  onChange={e => setRef(e.target.value)}
                  placeholder="Not on the bank statement"
                  autoComplete="off"
                  autoFocus
                  maxLength={200}
                />
              </div>
            )}
            {problem ? (
              <p className="text-sm text-destructive" role="alert">
                {problem}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                size="sm"
                variant={form === "checked" ? "default" : "outline"}
                disabled={sending}
              >
                {sending ? <Loader2 className={spin} aria-hidden /> : null}
                {sending
                  ? form === "checked"
                    ? "Checking"
                    : "Rejecting"
                  : form === "checked"
                    ? "Check"
                    : "Reject"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setForm(null)}
                disabled={sending}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {showTicket && ticket && !done ? (
          <div className="rounded-lg border p-3">{ticket(row)}</div>
        ) : null}
      </div>
    </li>
  );
}
