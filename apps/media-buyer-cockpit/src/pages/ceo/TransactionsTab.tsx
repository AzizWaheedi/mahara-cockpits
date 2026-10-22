import { ReceiptText } from "lucide-react";
import { useMemo, useState } from "react";
import { useTabParam } from "@/components/ceo/CeoTabs";
import { type Column, DataTable } from "@/components/ceo/DataTable";
import { EmptyState } from "@/components/ceo/EmptyState";
import { Facts } from "@/components/ceo/Facts";
import { FilterChips, type FilterOption } from "@/components/ceo/FilterChips";
import { count, money, plural, shortDate } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { TabLink } from "@/components/ceo/TabLink";
import { TimeframeBar } from "@/components/ceo/TimeframeBar";
import { useTimeframe } from "@/components/ceo/timeframe";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { api, useAction, useMutation } from "@/lib/cockpitApi";
import { cn } from "@/lib/utils";
import type { MoneyAttribution, Note } from "@/types/ceo/payloads";
import { AttributeSheet } from "./money/AttributeSheet";
import {
  canAttribute,
  creditLine,
  freshPending,
  isStatementLine,
  type MoneyLine,
  type MoneyTotals,
  moneyTotals,
  type PendingTie,
  pendingFor,
  pendingWords,
  restsOn,
  sideWords,
} from "./money/credit";
import type { CeoTabProps } from "./types";

/**
 * Transactions: every payment in and out over the last twelve months, each
 * with the side of the business it belongs to, who it is credited to and
 * why, and the deal or client it rests on, or "not attributed" when nothing
 * tied it (Aziz, 2026-10-18: "make it easy for me to attribute any of the
 * money coming in"). The rule runs in the money refresh
 * (hermes/ceo-refresh/native/adapters/money.js, and its Edge copy
 * supabase/functions/cockpit-ceo-api/finance/attribution.ts); every money-in
 * row has an Attribute action that ties it, or every payment from its payer,
 * to a signed deal, a client card or "not client money"
 * (docs/money/MONEY-ATTRIBUTION.md section 2).
 */

const VIEW_KEYS = [
  "all",
  "unattributed",
  "front_end",
  "back_end",
  "not_client",
  "out",
  "bank",
] as const;
type ViewKey = (typeof VIEW_KEYS)[number];

const VIEWS: FilterOption<ViewKey>[] = [
  { key: "all", label: "Everything", hint: "Every payment in and out." },
  {
    key: "unattributed",
    label: "Not attributed",
    hint: "Payments in that match no deal and no client. Attribute each one.",
  },
  {
    key: "front_end",
    label: "Front end",
    hint: "Money on signed deals, credited to the deal's closer: the deposit, then the rest of the deal until its contract is paid, up to 120 days after signing.",
  },
  {
    key: "back_end",
    label: "Back end",
    hint: "Payments matched to a client after its deal's contract or term, credited to the client's CSM.",
  },
  {
    key: "not_client",
    label: "Not client money",
    hint: "Payments you tied as not client money.",
  },
  {
    key: "out",
    label: "Out",
    hint: "Whop refunds and the bank expenses loaded.",
  },
  {
    key: "bank",
    label: "Statement lines",
    hint: "Every line of every uploaded bank statement, with the kind the cockpit gave it. Payouts, settlements and own transfers sit here to show why a credit did not become cash.",
  },
];

const BANK_KINDS: { value: string; label: string }[] = [
  { value: "client_payment", label: "Client payment" },
  { value: "whop_payout", label: "Whop payout" },
  { value: "whop_topup", label: "Transfer into Whop" },
  { value: "tap_settlement", label: "Tap settlement" },
  { value: "ecom_settlement", label: "Ecom settlement" },
  { value: "own_transfer", label: "Own transfer" },
  { value: "refund_in", label: "Refund received" },
  { value: "expense", label: "Expense" },
  { value: "fee", label: "Bank fee" },
  { value: "excluded", label: "Excluded" },
  { value: "unknown", label: "Unknown" },
];

// The money notes this tab carries: the attribution rule, the ties, the payer mapping.
const NOTE_MATCH =
  /attribut|transactions tab|kickoff|payer mapping|your ties?\b/i;

const RAIL_LABEL: Record<MoneyLine["rail"], string> = {
  whop: "Whop",
  tap: "Tap",
  ecom: "Ecom",
  transfer: "Bank transfer",
  manual: "Logged by hand",
  bank: "Bank",
};

/**
 * The credit cell: the side and kind, then "Credited to <person>
 * (closer|CSM) · <why>" (rule 5), a tie saved this session that the next
 * refresh will show, the deal or card it rests on (or who paid, when nothing
 * does) when the table is too narrow for those columns, and the Attribute
 * action. On a phone the cell wraps inside the width left beside the day and
 * the amount, so the credit line is read without scrolling sideways.
 */
function Credit({
  t,
  pending,
  onAttribute,
}: {
  t: MoneyLine;
  pending: PendingTie[];
  onAttribute: (t: MoneyLine) => void;
}) {
  const line = creditLine(t);
  const on = restsOn(t);
  const mine = t.direction === "in" ? pendingFor(t, pending) : null;
  const payer = t.payerName ?? t.payerEmail;
  const statement = isStatementLine(t);
  const kind = BANK_KINDS.find(k => k.value === t.bankKind)?.label;
  const attribute = (className: string) =>
    canAttribute(t) ? (
      <button
        type="button"
        onClick={() => onAttribute(t)}
        className={cn(
          "no-touch relative shrink-0 rounded-sm text-xs font-medium text-[var(--ceo-emphasis)] underline-offset-4 after:absolute after:-inset-x-1.5 after:-inset-y-2 after:content-[''] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        Attribute
      </button>
    ) : null;
  return (
    <span className="block min-w-0 max-w-[10rem] whitespace-normal @xl:min-w-[13rem] @xl:max-w-[22rem]">
      <span className="flex items-baseline justify-between gap-3">
        <span
          className={cn(
            t.direction === "in" &&
              t.side === "unattributed" &&
              !statement &&
              "font-medium",
          )}
        >
          {statement ? "Statement line" : sideWords(t)}
        </span>
        {/* Beside the side on a wide table; under the credit on a narrow one. */}
        {attribute("hidden @xl:inline")}
      </span>
      {line ? (
        <span
          className="block text-xs text-muted-foreground"
          title={t.tie ? `Your note: ${t.tie.note}` : undefined}
        >
          {line}
        </span>
      ) : statement && t.direction === "in" ? (
        <span className="block text-xs text-muted-foreground">
          {t.bankKind === "unknown" || !kind
            ? "Not counted as client money until it has a kind"
            : `Not client money: ${kind.toLowerCase()}`}
        </span>
      ) : null}
      {mine ? (
        <span
          className="block text-xs font-medium text-[var(--ceo-emphasis)]"
          title={`Your note: ${mine.note}`}
        >
          {pendingWords(mine)}
        </span>
      ) : null}
      {t.direction === "in" && (on || payer || canAttribute(t)) ? (
        <span className="flex items-baseline gap-3 text-xs text-muted-foreground @xl:hidden">
          {on ? (
            <span className="min-w-0 truncate">
              on <bdi>{on}</bdi>
            </span>
          ) : payer && !statement ? (
            <span className="min-w-0 truncate">
              from <bdi>{payer}</bdi>
            </span>
          ) : null}
          {attribute("")}
        </span>
      ) : null}
    </span>
  );
}

function columnsFor(
  onAttribute: (t: MoneyLine) => void,
  pending: PendingTie[],
): Column<MoneyLine>[] {
  return [
    {
      key: "day",
      header: "Day",
      cell: t => <span className="whitespace-nowrap">{shortDate(t.day)}</span>,
      sortValue: t => t.day,
    },
    {
      key: "usd",
      header: "Amount",
      cell: t => (
        <span className={t.direction === "out" ? "text-muted-foreground" : ""}>
          {t.direction === "out" ? "−" : ""}
          {money(t.usd)}
          {t.currency !== "USD" ? (
            <span className="block text-xs text-muted-foreground">
              {t.amount} {t.currency}
            </span>
          ) : null}
        </span>
      ),
      sortValue: t => (t.direction === "out" ? -t.usd : t.usd),
      numeric: true,
    },
    // Who it is credited to comes first after the amount: it is what the tab
    // is for, and on a phone it is in view before the table scrolls sideways.
    {
      key: "credit",
      header: "Credited to",
      cell: t => <Credit t={t} pending={pending} onAttribute={onAttribute} />,
      sortValue: t => `${t.side}:${t.person ?? ""}`,
    },
    {
      key: "payer",
      header: "Payer",
      cell: t => (
        <span className="block min-w-0 max-w-[16rem]">
          <span className="block truncate" title={t.payerName ?? undefined}>
            {t.payerName ?? (
              <span className="text-muted-foreground">no name</span>
            )}
          </span>
          {t.payerEmail ? (
            <span
              className="block truncate text-xs text-muted-foreground"
              title={t.payerEmail}
            >
              {t.payerEmail}
            </span>
          ) : null}
        </span>
      ),
      sortValue: t => t.payerName ?? "",
    },
    {
      key: "rail",
      header: "Rail",
      cell: t => RAIL_LABEL[t.rail],
      sortValue: t => t.rail,
      hideBelow: "sm",
    },
    {
      key: "client",
      header: "Deal or client",
      cell: t => (
        <span className="block min-w-0 max-w-[14rem] truncate">
          {restsOn(t) ?? (
            <span className="text-muted-foreground">
              {t.direction === "in" ? "none" : ""}
            </span>
          )}
        </span>
      ),
      sortValue: t => restsOn(t) ?? "",
      hideBelow: "md",
    },
    {
      key: "detail",
      header: "Detail",
      cell: t => (
        <span className="block max-w-[14rem] truncate text-xs text-muted-foreground">
          {t.detail ?? ""}
        </span>
      ),
      hideBelow: "lg",
    },
  ];
}

/** A statement line can be given another kind by hand, for the cases the rules get wrong. */
function Reclassify({ t }: { t: MoneyLine }) {
  const reclassify = useAction(api.ceo.bankImport.reclassify);
  const refreshNow = useMutation(api.ceo.queries.refreshNow);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (t.bankLineId === undefined) return null;
  return (
    <AnimatedSelect
      aria-label="Kind of this statement line"
      value={done ?? t.bankKind ?? "unknown"}
      disabled={busy}
      onChange={async e => {
        const kind = e.target.value;
        setBusy(true);
        try {
          await reclassify({ id: t.bankLineId as number, kind: kind as never });
          setDone(kind);
          await refreshNow({ only: ["money", "expenses"] });
        } finally {
          setBusy(false);
        }
      }}
      className="ceo-select-compact max-w-[11rem]"
    >
      {BANK_KINDS.map(k => (
        <option key={k.value} value={k.value}>
          {k.label}
        </option>
      ))}
    </AnimatedSelect>
  );
}

const RECLASSIFY_COLUMN: Column<MoneyLine> = {
  key: "reclassify",
  header: "Kind",
  cell: t => <Reclassify t={t} />,
  hideBelow: "md",
};

export function TransactionsTab({ sections, goTab }: CeoTabProps) {
  const section = sections.money;
  const a = section?.payload?.attribution ?? null;
  // The published lines carry the deal, the tie and "not client money" since
  // 2026-10-18, typed (optional for older payloads) in src/types/ceo/payloads.ts.
  const lines: MoneyLine[] = a?.transactions ?? [];
  const [attributing, setAttributing] = useState<MoneyLine | null>(null);
  // Ties saved here since the section last published: the rows say them at once.
  const [saved, setSaved] = useState<PendingTie[]>([]);
  const lastOkAt = section?.lastOkAt ?? null;
  const pending = useMemo(
    () => freshPending(saved, lastOkAt),
    [saved, lastOkAt],
  );
  const [view, setView] = useTabParam(VIEW_KEYS, "all", "view");
  const tf = useTimeframe("12m");
  const notes = useMemo<Note[]>(
    () => (section?.payload?.notes ?? []).filter(n => NOTE_MATCH.test(n.text)),
    [section],
  );
  // The stored list is newest first and capped, so the oldest line present is
  // the floor of what any timeframe here can honestly answer.
  const oldest = a?.transactions.length
    ? a.transactions[a.transactions.length - 1].day
    : null;
  const bounds = a ? tf.bounds(a.to, oldest ?? a.from) : null;
  const inWindow = useMemo(() => {
    if (!bounds) return [];
    return lines.filter(t => t.day >= bounds.from && t.day <= bounds.to);
  }, [lines, bounds]);
  const rows = useMemo(() => {
    if (view === "all") return inWindow;
    if (view === "out") return inWindow.filter(t => t.direction === "out");
    if (view === "bank")
      return inWindow.filter(
        t => t.bankLineId !== undefined || t.id.startsWith("bank:"),
      );
    return inWindow.filter(t => t.side === view);
  }, [inWindow, view]);
  const windowTotals = useMemo(() => moneyTotals(inWindow), [inWindow]);
  const columns = useMemo(
    () => [...columnsFor(setAttributing, pending), RECLASSIFY_COLUMN],
    [pending],
  );

  if (!a)
    return (
      <div className="grid gap-4 lg:gap-6">
        <SectionCard title="Every payment in and out" section={section}>
          {() => (
            <EmptyState
              title="Payments have not been attributed yet"
              text="The money section gives every payment a side on its next refresh."
              icon={ReceiptText}
              compact
            />
          )}
        </SectionCard>
      </div>
    );

  const truncated = Boolean(
    oldest && bounds && bounds.from < oldest && a.from < oldest,
  );

  const total = a.transactions.length;
  return (
    <div className="grid gap-4 lg:gap-6">
      <TimeframeBar
        tf={tf}
        bounds={bounds}
        ariaLabel="Timeframe for the payments listed"
        first={oldest ?? a.from}
        last={a.to}
        note={
          truncated
            ? `The stored list starts at ${shortDate(oldest as string)} ${(oldest as string).slice(0, 4)}; anything before that is not on this tab.`
            : undefined
        }
      />
      {/* The timeframe bar above already names the days, so the card only
          says where its numbers come from. */}
      <SectionCard
        title="Where the money sits"
        description={
          bounds
            ? "Added up from the payments listed below."
            : "Pick both dates above."
        }
        section={section}
        notes={notes}
        actions={<TabLink tab="money" label="Money" goTab={goTab} />}
        order={0}
      >
        {() => <Totals a={a} t={windowTotals} />}
      </SectionCard>

      <SectionCard
        title="Every payment in and out"
        description={
          rows.length === total
            ? plural(total, "line")
            : `${count(rows.length)} of ${plural(total, "line")}`
        }
        section={section}
        order={1}
      >
        {() => (
          // The views sit on the table's own filter row, full width, so on a
          // phone they scroll sideways instead of being clipped in the header.
          // The table is as wide as its columns (min-w-max) and scrolls inside
          // the card; the first 50 lines show, then 50 more per press.
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={t => t.id}
            initialSort={{ key: "day", dir: "desc" }}
            caption="Payments in and out for the timeframe chosen, newest first, with the side, who each is credited to and why, and the deal or client it rests on"
            emptyText="Nothing in this view."
            stickyFirst
            pageSize={50}
            tableClassName="min-w-max"
            search={{
              placeholder: "Payer, email, deal, client or person",
              text: t =>
                [t.payerName, t.payerEmail, restsOn(t), t.person]
                  .filter(Boolean)
                  .join(" "),
            }}
            filters={
              <FilterChips
                options={VIEWS}
                value={view}
                onChange={setView}
                ariaLabel="Which payments to list"
              />
            }
          />
        )}
      </SectionCard>

      <AttributeSheet
        subject={attributing ? { kind: "payment", line: attributing } : null}
        lines={lines}
        lastRefreshAt={section?.lastOkAt ?? null}
        pending={pending}
        onTied={p => setSaved(v => [...v, p])}
        onClose={() => setAttributing(null)}
      />
    </div>
  );
}

function Totals({ a, t }: { a: MoneyAttribution; t: MoneyTotals }) {
  const mtd = a.mtd;
  // What the money refresh did with the CEO's ties this run (since 2026-10-18).
  const ties = a.ties;
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 @xl:grid-cols-3 @4xl:grid-cols-5">
        <StatTile
          variant="plain"
          label="Money in"
          value={money(t.in)}
          sub={plural(t.count, "payment")}
          hint="Every paid Whop payment (net of refunds), Tap charge, bank transfer and hand-logged payment over the last twelve months. Statement lines that are not client money (Whop payouts, Tap settlements, your own transfers) are listed but not counted."
        />
        <StatTile
          variant="plain"
          label="Front end"
          value={money(t.frontEnd)}
          sub={`${money(t.deposit)} deposits · ${money(t.remainder)} rest of the deals`}
          hint="Money on signed deals, credited to the deal's closer: the deposit up to what the closer typed on the form, then the rest of the deal until its contract is paid, from 7 days before the form to 120 days after signing."
        />
        <StatTile
          variant="plain"
          label="Back end"
          value={money(t.backEnd)}
          hint="Payments matched to a client once its deal's contract is paid or 120 days after signing, or to a client with no deal in its term, credited to that client's CSM."
        />
        <StatTile
          variant="plain"
          label="Not attributed"
          value={money(t.unattributed)}
          sub={plural(t.unattributedCount, "payment")}
          hint="Payments in that match no deal and no client by any rule. Press Attribute on the payment to tie it, or every payment from its payer, to a signed deal, a client card or not client money."
        />
        <StatTile
          variant="plain"
          label="Money out"
          value={money(t.out)}
          sub={`${count(t.outCount)} lines: Whop refunds and bank expenses`}
          hint="Whop refunds, which are already netted off the charge they refund, and the bank expenses loaded for the months the import covers."
        />
      </div>
      <Facts
        items={[
          {
            label: "This month, front end",
            value: `${money(mtd.frontEnd)} (${money(mtd.deposit)} deposits, ${money(mtd.remainder ?? mtd.kickoff)} rest)`,
          },
          { label: "This month, back end", value: money(a.mtd.backEnd) },
          {
            label: "This month, not attributed",
            value: `${money(a.mtd.unattributed)} (${plural(a.mtd.unattributedCount, "payment")})`,
          },
          {
            label: "Not client money",
            value:
              t.notClientCount > 0
                ? `${money(t.notClient)} (${plural(t.notClientCount, "payment")})`
                : null,
            hint: "Payments you tied as not client money: in none of the sides above.",
          },
          {
            label: "Your ties",
            value: ties
              ? `${count(ties.applied)} of ${count(ties.live)} applied, ${plural(ties.payments, "payment")}`
              : null,
            hint: ties?.notApplied.length
              ? `${plural(ties.notApplied.length, "tie")} credited no payment this run; the note on this card says why.`
              : ties?.beforeDeal?.length
                ? `${plural(
                    ties.beforeDeal.reduce((n, i) => n + i.payments, 0),
                    "payment",
                  )} from a tied payer came more than 7 days before the deal's form and stay with the automatic rules; the note on this card says which.`
                : "Every tie you set is read by the money refresh before any automatic match.",
          },
        ]}
      />
    </div>
  );
}
