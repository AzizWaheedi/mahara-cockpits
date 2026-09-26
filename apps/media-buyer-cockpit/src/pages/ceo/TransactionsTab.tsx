import { useAction, useMutation } from "convex/react";
import { ReceiptText } from "lucide-react";
import { useMemo, useState } from "react";
import { useTabParam } from "@/components/ceo/CeoTabs";
import { type Column, DataTable } from "@/components/ceo/DataTable";
import { EmptyState } from "@/components/ceo/EmptyState";
import { Facts } from "@/components/ceo/Facts";
import { FilterChips, type FilterOption } from "@/components/ceo/FilterChips";
import { count, money, plural, shortDate } from "@/components/ceo/format";
import { Na } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { TabLink } from "@/components/ceo/TabLink";
import { TimeframeBar } from "@/components/ceo/TimeframeBar";
import { useTimeframe } from "@/components/ceo/timeframe";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { api } from "../../../convex/_generated/api";
import type {
  AttributionTotals,
  MoneyAttribution,
  Note,
  Transaction,
} from "../../../convex/ceo/payloads";
import type { CeoTabProps } from "./types";

/**
 * Transactions: every payment in and out over the last twelve months, each
 * with the side of the business it belongs to, the person it is credited to
 * and the deal or client it was tied to, or "not attributed" when nothing
 * tied it. The rules are in convex/ceo/attribution.ts and the money adapter
 * loads the rows.
 */

const VIEW_KEYS = [
  "all",
  "unattributed",
  "front_end",
  "back_end",
  "out",
  "bank",
] as const;
type ViewKey = (typeof VIEW_KEYS)[number];

const VIEWS: FilterOption<ViewKey>[] = [
  { key: "all", label: "Everything", hint: "Every payment in and out." },
  {
    key: "unattributed",
    label: "Not attributed",
    hint: "Payments in that match no deal and no client.",
  },
  {
    key: "front_end",
    label: "Front end",
    hint: "Deposits at signing and the rest of the cash on the onboarding call.",
  },
  {
    key: "back_end",
    label: "Back end",
    hint: "Payments matched to an existing client.",
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
  { value: "own_transfer", label: "Own transfer" },
  { value: "refund_in", label: "Refund received" },
  { value: "expense", label: "Expense" },
  { value: "fee", label: "Bank fee" },
  { value: "excluded", label: "Excluded" },
  { value: "unknown", label: "Unknown" },
];

const RAIL_LABEL: Record<Transaction["rail"], string> = {
  whop: "Whop",
  tap: "Tap",
  transfer: "Bank transfer",
  manual: "Logged by hand",
  bank: "Bank",
};

const KIND_LABEL: Record<Transaction["kind"], string> = {
  deposit: "Deposit at signing",
  kickoff: "Rest of the cash",
  client: "Client payment",
  none: "Not attributed",
  refund: "Refund",
  expense: "Expense",
};

const SIDE_LABEL: Record<Transaction["side"], string> = {
  front_end: "Front end",
  back_end: "Back end",
  unattributed: "Not attributed",
  out: "Out",
};

const MATCH_LABEL: Record<string, string> = {
  deal_id: "Whop's own link to the deal",
  deal_email: "payer email on the closer form",
  deal_name: "business name on the closer form",
  card_email: "portal login on the client card",
  card_payer: "payer mapped by hand",
  card_name: "client card name",
  card_typed: "card chosen when logged",
  none: "nothing",
};

const NOTE_MATCH = /attribut|transactions tab|kickoff|payer mapping/i;

function role(t: Transaction): string {
  if (!t.person) return "";
  return t.personRole === "closer" ? `${t.person}, closer` : `${t.person}, CSM`;
}

const COLUMNS: Column<Transaction>[] = [
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
  {
    key: "rail",
    header: "Rail",
    cell: t => RAIL_LABEL[t.rail],
    sortValue: t => t.rail,
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
    key: "side",
    header: "Attribution",
    cell: t => (
      <span className="block">
        <span className={t.side === "unattributed" ? "font-medium" : ""}>
          {SIDE_LABEL[t.side]}
        </span>
        <span className="block text-xs text-muted-foreground">
          {KIND_LABEL[t.kind]}
        </span>
      </span>
    ),
    sortValue: t => `${t.side}:${t.kind}`,
  },
  {
    key: "person",
    header: "Credited to",
    cell: t => role(t) || <Na hint="Nobody is credited with this payment" />,
    sortValue: t => t.person ?? "",
    hideBelow: "md",
  },
  {
    key: "client",
    header: "Deal or client",
    cell: t => (
      <span className="block min-w-0 max-w-[14rem] truncate">
        {t.dealBusiness ?? t.clientName ?? (
          <Na hint="Tied to no deal and no client" />
        )}
      </span>
    ),
    sortValue: t => t.dealBusiness ?? t.clientName ?? "",
    hideBelow: "md",
  },
  {
    key: "matchedBy",
    header: "Tied by",
    cell: t => (
      <span className="text-xs text-muted-foreground">
        {MATCH_LABEL[t.matchedBy] ?? t.matchedBy}
      </span>
    ),
    hideBelow: "lg",
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

/** A statement line can be given another kind by hand, for the cases the rules get wrong. */
function Reclassify({ t }: { t: Transaction }) {
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

const RECLASSIFY_COLUMN: Column<Transaction> = {
  key: "reclassify",
  header: "Kind",
  cell: t => <Reclassify t={t} />,
  hideBelow: "md",
};

/** The five headline numbers, added up from whichever payments are in view. */
function totalsOf(rows: Transaction[]): AttributionTotals & {
  out: number;
  outCount: number;
} {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const ins = rows.filter(t => t.direction === "in");
  const sum = (f: (t: Transaction) => boolean) =>
    r2(ins.filter(f).reduce((n, t) => n + t.usd, 0));
  const outs = rows.filter(t => t.direction === "out");
  return {
    in: sum(() => true),
    count: ins.length,
    frontEnd: sum(t => t.side === "front_end"),
    deposit: sum(t => t.kind === "deposit"),
    kickoff: sum(t => t.kind === "kickoff"),
    backEnd: sum(t => t.side === "back_end"),
    unattributed: sum(t => t.side === "unattributed"),
    unattributedCount: ins.filter(t => t.side === "unattributed").length,
    out: r2(outs.reduce((n, t) => n + t.usd, 0)),
    outCount: outs.length,
  };
}

export function TransactionsTab({ sections, goTab }: CeoTabProps) {
  const section = sections.money;
  const a = section?.payload?.attribution ?? null;
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
    if (!a) return [];
    if (!bounds) return [];
    return a.transactions.filter(
      t => t.day >= bounds.from && t.day <= bounds.to,
    );
  }, [a, bounds]);
  const rows = useMemo(() => {
    if (view === "all") return inWindow;
    if (view === "out") return inWindow.filter(t => t.direction === "out");
    if (view === "bank")
      return inWindow.filter(
        t => t.bankLineId !== undefined || t.id.startsWith("bank:"),
      );
    return inWindow.filter(t => t.side === view);
  }, [inWindow, view]);
  const windowTotals = useMemo(() => totalsOf(inWindow), [inWindow]);
  const columns = useMemo(() => [...COLUMNS, RECLASSIFY_COLUMN], []);

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
        {() => <Totals a={{ ...a, totals: windowTotals }} />}
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
            caption="Payments in and out for the timeframe chosen, newest first, with the side, the person and the deal or client each was tied to"
            emptyText="Nothing in this view."
            stickyFirst
            pageSize={50}
            tableClassName="min-w-max"
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
    </div>
  );
}

function Totals({ a }: { a: MoneyAttribution }) {
  const t = a.totals;
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 @xl:grid-cols-3 @4xl:grid-cols-5">
        <StatTile
          variant="plain"
          label="Money in"
          value={money(t.in)}
          sub={plural(t.count, "payment")}
          hint="Every paid Whop payment (net of refunds), Tap charge, bank transfer and hand-logged payment over the last twelve months."
        />
        <StatTile
          variant="plain"
          label="Front end"
          value={money(t.frontEnd)}
          sub={`${money(t.deposit)} deposits · ${money(t.kickoff)} rest of the cash`}
          hint="Deposits at signing, credited to the closer, and the rest of the cash inside the front-end window, credited to the CSM on the deal."
        />
        <StatTile
          variant="plain"
          label="Back end"
          value={money(t.backEnd)}
          hint="Payments matched to an existing client after its front-end window, credited to that client's CSM."
        />
        <StatTile
          variant="plain"
          label="Not attributed"
          value={money(t.unattributed)}
          sub={plural(t.unattributedCount, "payment")}
          hint="Payments in that match no deal and no client by any rule. Map the payer on the Money tab, or add the login to the client's portal access, and they move."
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
            value: `${money(a.mtd.frontEnd)} (${money(a.mtd.deposit)} deposits, ${money(a.mtd.kickoff)} rest)`,
          },
          { label: "This month, back end", value: money(a.mtd.backEnd) },
          {
            label: "This month, not attributed",
            value: `${money(a.mtd.unattributed)} (${plural(a.mtd.unattributedCount, "payment")})`,
          },
        ]}
      />
    </div>
  );
}
