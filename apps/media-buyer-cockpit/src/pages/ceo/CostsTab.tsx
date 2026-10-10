import { Loader2, Plus, Receipt, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { count, money, plural, shortDate } from "@/components/ceo/format";
import { KICKER } from "@/components/ceo/Kicker";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { api, useAction } from "@/lib/cockpitApi";
import { cn } from "@/lib/utils";
import {
  COMMISSION_BASES,
  COMMISSION_SHORT,
  type CommissionBasis,
  SHARE_BASES,
} from "@/types/ceo/commission";
import type { Sheet } from "@/types/ceo/costs";
import {
  type ClosedMonthPay,
  type CostKind,
  type CostLine,
  monthlyUsd,
  payroll,
  totalOf,
} from "@/types/ceo/costsModel";
import { planName } from "./goalsKit";
import type { CeoTabProps } from "./types";

/**
 * What a month costs, as a sheet.
 *
 * Aziz, 2026-10-02: "a spreadsheet in the money section for all software
 * expenses, so I can see them at a high level, or at least an estimate of
 * what it's going to be every month... If I add a seat, it can easily just
 * change how much the software expenses should be... the payroll... depending
 * on who's active... the commissions for the projections... labor, overhead
 * and marketing."
 *
 * Three costs, each with its own sheet: labour (the roster, base pay plus
 * each person's commission priced on a plan), overhead (software, priced by
 * the seat, and everything else that comes every month) and marketing (the
 * plan's ad spend plus any other marketing line). Every cell you can change
 * is a cell: change seats and the line, its sheet and the month move at
 * once. Last month's real spend from the statements sits beside each, so the
 * estimate is never read alone.
 */

const cell =
  "w-full min-w-0 rounded bg-transparent px-2 py-1.5 tabular-nums outline-none transition-colors hover:bg-muted/50 focus:bg-background focus:ring-2 focus:ring-ring";
const say = { money, count };

/** A number that washes teal once when it changes, like next month's plan. */
function Moving({ value, className }: { value: string; className?: string }) {
  const first = useRef(value);
  return (
    <span
      key={value}
      className={cn(
        "rounded px-1 tabular-nums",
        value !== first.current && "ceo-flash",
        className,
      )}
    >
      {value}
    </span>
  );
}

const KIND_WORDS: Record<
  CostKind,
  { title: string; blurb: string; add: string; empty: string }
> = {
  software: {
    title: "Software",
    blurb:
      "Every tool, by the seat where it is billed that way. Change the seats and the month moves.",
    add: "Add a tool",
    empty: "No software on the sheet yet. Add each tool you pay for.",
  },
  overhead: {
    title: "Other overhead",
    blurb:
      "Everything else that comes every month and is not a person or an ad.",
    add: "Add a line",
    empty: "Nothing else on the sheet yet: rent, accounting, bank fees.",
  },
  marketing: {
    title: "Other marketing",
    blurb:
      "Marketing that is not the plan's ad spend: agencies, production, tools.",
    add: "Add a line",
    empty: "Only the plan's ad spend so far.",
  },
};

let draftId = -1;

export function CostsTab({ goTab }: CeoTabProps) {
  const read = useAction(api.ceo.costs.sheet);
  const saveLine = useAction(api.ceo.costs.save);
  const removeLine = useAction(api.ceo.costs.remove);
  const savePay = useAction(api.ceo.people.setPay);

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [planId, setPlanId] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lines, setLines] = useState<CostLine[]>([]);
  const [people, setPeople] = useState<Sheet["people"]>([]);
  const [focusId, setFocusId] = useState<number | null>(null);

  const load = useCallback(
    async (id?: number) => {
      setBusy(true);
      setError(null);
      try {
        const s = (await read({ planId: id })) as Sheet;
        setSheet(s);
        setLines(s.lines);
        setPeople(s.people);
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e).slice(0, 300));
      } finally {
        setBusy(false);
      }
    },
    [read],
  );
  useEffect(() => {
    void load(planId);
  }, [planId, load]);

  const fx = sheet?.usdPer ?? {};
  const software = useMemo(() => totalOf(lines, "software", fx), [lines, fx]);
  const overhead = useMemo(() => totalOf(lines, "overhead", fx), [lines, fx]);
  const marketing = useMemo(() => totalOf(lines, "marketing", fx), [lines, fx]);
  const pay = useMemo(
    () => (sheet ? payroll(people, sheet.projection, fx, say) : null),
    [sheet, people, fx],
  );

  if (busy && !sheet)
    return (
      <SectionCard title="What a month costs" order={0}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Reading the sheet
        </p>
      </SectionCard>
    );
  if (error || !sheet || !pay)
    return (
      <SectionCard title="The sheet could not be read" order={0}>
        <p className="text-sm text-muted-foreground">
          {error ?? "Nothing came back. Open the page again in a minute."}
        </p>
      </SectionCard>
    );

  const ads =
    (sheet.planned.spend ?? 0) + (sheet.planned.spendRetargeting ?? 0);
  const plannedAds =
    sheet.planned.spend !== null || sheet.planned.spendRetargeting !== null;
  const labour = pay.total;
  const overheadTotal = software.usd + overhead.usd;
  const marketingTotal = ads + marketing.usd;
  const total = labour + overheadTotal + marketingTotal;
  const st = sheet.statements;
  const spent = (k: string) => st?.byCategory[k] ?? 0;
  const lastMonth = st
    ? new Date(`${st.month}-01T00:00:00Z`).toLocaleString("en", {
        month: "long",
        timeZone: "UTC",
      })
    : null;

  /** Save one line: the sheet already shows the change; the server confirms it. */
  async function commit(line: CostLine) {
    if (!line.name.trim()) return;
    setSaveError(null);
    try {
      const out = (await saveLine({
        ...(line.id > 0 ? { id: line.id } : {}),
        kind: line.kind,
        name: line.name,
        category: line.category,
        billing: line.billing,
        seats: line.seats,
        unitPrice: line.unitPrice,
        currency: line.currency,
        paidWith: line.paidWith,
        match: line.match,
        status: line.status,
        note: line.note,
        sort: line.sort,
      })) as { line?: CostLine } | null;
      // The row the server kept, which carries its new id once added.
      const kept = out?.line;
      if (kept) setLines(cur => cur.map(l => (l.id === line.id ? kept : l)));
    } catch (e) {
      setSaveError(String(e instanceof Error ? e.message : e).slice(0, 300));
    }
  }

  async function drop(line: CostLine) {
    setLines(cur => cur.filter(l => l.id !== line.id));
    if (line.id < 0) return;
    try {
      await removeLine({ id: line.id });
    } catch (e) {
      setSaveError(String(e instanceof Error ? e.message : e).slice(0, 300));
      void load(planId);
    }
  }

  function add(kind: CostKind) {
    const id = draftId--;
    setFocusId(id);
    setLines(cur => [
      ...cur,
      {
        id,
        kind,
        name: "",
        category: null,
        billing: "monthly",
        seats: kind === "software" ? 1 : null,
        unitPrice: 0,
        currency: "USD",
        paidWith: null,
        match: null,
        status: "active",
        note: null,
        sort: cur.filter(l => l.kind === kind).length,
      },
    ]);
  }

  async function changePay(
    id: number,
    patch: {
      monthlyCost?: number | null;
      commissionBasis?: CommissionBasis;
      commissionRate?: number | null;
    },
  ) {
    setSaveError(null);
    try {
      await savePay({ id, ...patch });
    } catch (e) {
      setSaveError(String(e instanceof Error ? e.message : e).slice(0, 300));
      void load(planId);
    }
  }

  const projectionWords = [
    ["new-client cash", sheet.projection.newCash, money],
    ["contracted", sheet.projection.contracted, money],
    ["live demos", sheet.projection.demosShown, count],
    ["intros held", sheet.projection.introsShown, count],
    ["clients signed", sheet.projection.closes, count],
    ["MRR due", sheet.projection.mrrDue, money],
  ] as const;

  return (
    <div className="@container grid gap-4 lg:gap-6">
      <SectionCard
        title="What a month costs"
        description={
          sheet.plan
            ? `Commissions and ad spend priced on the ${planName(sheet.plan.title)}${sheet.plan.status === "draft" ? " (draft)" : ""}.`
            : "No plan yet, so commissions and ad spend have nothing to be priced on. Write one on Goals."
        }
        order={0}
        actions={
          sheet.plans.length > 1 ? (
            <AnimatedSelect
              aria-label="Which plan prices the month"
              className="ceo-select-sm max-w-60"
              value={String(sheet.plan?.id ?? "")}
              onChange={e => setPlanId(Number(e.target.value))}
            >
              {sheet.plans.map(p => (
                <option key={p.id} value={p.id}>
                  {`${planName(p.title)}${p.status === "draft" ? " (draft)" : ""}`}
                </option>
              ))}
            </AnimatedSelect>
          ) : null
        }
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 @2xl:grid-cols-4">
          <StatTile
            variant="plain"
            label="Labour"
            value={<Moving value={money(labour)} />}
            sub={`${money(pay.base)} pay + ${money(pay.commission)} commission`}
          />
          <StatTile
            variant="plain"
            label="Overhead"
            value={<Moving value={money(overheadTotal)} />}
            sub={`${money(software.usd)} software + ${money(overhead.usd)} other`}
          />
          <StatTile
            variant="plain"
            label="Marketing"
            value={<Moving value={money(marketingTotal)} />}
            sub={
              plannedAds
                ? `${money(ads)} ad spend + ${money(marketing.usd)} other`
                : "No ad spend in the plan"
            }
          />
          <StatTile
            variant="plain"
            label="A month, all in"
            value={<Moving value={money(total)} />}
            sub="Labour, overhead and marketing"
          />
        </div>
        {st ? (
          <div className="ceo-facts">
            <span className="text-xs text-muted-foreground">
              {`${lastMonth} on the statements${st.through ? `, to ${shortDate(st.through)}` : ""}:`}
            </span>
            <span className="text-xs">{`software ${money(spent("software"))}`}</span>
            <span className="text-xs">{`ads ${money(spent("ads"))}`}</span>
            <span className="text-xs">{`labour ${money(spent("labour"))}`}</span>
            {sheet.lastMonthPay ? (
              <span className="text-xs">{`base pay ${money(sheet.lastMonthPay.total)}`}</span>
            ) : null}
            <span className="text-xs">{`other ${money(spent("other") + spent("bank") + spent("courses"))}`}</span>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Last month's statement expenses are missing. Import the bank
            statements in Money to compare them.
          </p>
        )}
        {saveError ? (
          <p className="mt-3 text-sm text-[var(--ceo-critical)]">{saveError}</p>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Payroll"
        description="Everyone working now, from Team & payroll. Pay and commission change here; people are added and removed there."
        order={1}
        actions={
          <Button variant="outline" size="sm" onClick={() => goTab("team")}>
            Team & payroll
          </Button>
        }
      >
        {people.length ? (
          <div className="ceo-table-scroll -mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 text-left font-medium">Person</th>
                  <th className="w-32 py-2 text-right font-medium">
                    Pay a month
                  </th>
                  <th className="w-64 py-2 pl-3 text-left font-medium">
                    Commission
                  </th>
                  <th className="py-2 text-right font-medium">On the plan</th>
                  <th className="w-28 py-2 text-right font-medium">Month</th>
                </tr>
              </thead>
              <tbody>
                {people.map(person => {
                  const line = pay.lines.find(l => l.id === person.id);
                  const share = SHARE_BASES.has(person.basis);
                  return (
                    <tr key={person.id} className="border-b last:border-b-0">
                      <td className="py-1.5 pr-3">
                        <span className="font-medium">{person.name}</span>
                        {person.role ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {person.role}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5">
                        <PayCell
                          person={person}
                          fx={fx}
                          onChange={usd => {
                            setPeople(cur =>
                              cur.map(x =>
                                x.id === person.id
                                  ? { ...x, monthlyUsd: usd }
                                  : x,
                              ),
                            );
                          }}
                          onCommit={amount =>
                            void changePay(person.id, { monthlyCost: amount })
                          }
                        />
                      </td>
                      <td className="py-1.5 pl-3">
                        <span className="flex items-center gap-1">
                          <AnimatedSelect
                            aria-label={`${person.name}'s commission`}
                            className="ceo-select-sm min-w-0 flex-1"
                            value={person.basis}
                            onChange={e => {
                              const basis = e.target.value as CommissionBasis;
                              // A share and an amount per unit are different
                              // units: 10% is not $0.10 a demo.
                              const rate =
                                basis === "none" ||
                                basis === "other" ||
                                SHARE_BASES.has(basis) !==
                                  SHARE_BASES.has(person.basis)
                                  ? null
                                  : person.rate;
                              setPeople(cur =>
                                cur.map(x =>
                                  x.id === person.id
                                    ? { ...x, basis, rate }
                                    : x,
                                ),
                              );
                              void changePay(person.id, {
                                commissionBasis: basis,
                                commissionRate: rate,
                              });
                            }}
                          >
                            {COMMISSION_BASES.map(b => (
                              <option key={b} value={b}>
                                {COMMISSION_SHORT[b]}
                              </option>
                            ))}
                          </AnimatedSelect>
                          {person.basis !== "none" &&
                          person.basis !== "other" ? (
                            <RateCell
                              share={share}
                              currency={person.currency}
                              rate={person.rate}
                              label={`${person.name}'s commission rate`}
                              onChange={rate =>
                                setPeople(cur =>
                                  cur.map(x =>
                                    x.id === person.id ? { ...x, rate } : x,
                                  ),
                                )
                              }
                              onCommit={rate =>
                                void changePay(person.id, {
                                  commissionRate: rate,
                                })
                              }
                            />
                          ) : null}
                        </span>
                      </td>
                      <td className="py-1.5 text-right text-xs text-muted-foreground">
                        {person.basis === "other"
                          ? "Not priced: pick a rule"
                          : (line?.on ??
                            (person.basis === "none" ? "" : "No plan number"))}
                      </td>
                      <td className="py-1.5 text-right font-medium">
                        <Moving value={money(line?.total ?? null)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t">
                  <td
                    className="pt-2 text-xs text-muted-foreground"
                    colSpan={4}
                  >
                    {`${count(people.length)} working: ${money(pay.base)} pay, ${money(pay.commission)} commission`}
                  </td>
                  <td className="pt-2 text-right font-semibold">
                    <Moving value={money(pay.total)} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Nobody on the payroll yet"
            text="Add the team on Team & payroll and their pay shows here."
            compact
          />
        )}
        <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
          {sheet.plan ? (
            <p>
              {`Priced on the ${planName(sheet.plan.title)}: ${
                projectionWords
                  .filter(([, v]) => v !== null)
                  .map(([w, v, f]) => `${w} ${f(v as number)}`)
                  .join(", ") || "it has no new cash, demos or MRR to price on"
              }. People on the same rule split it.`}
            </p>
          ) : null}
          {pay.noPay.length ? (
            <p>{`No pay set for ${pay.noPay.join(", ")}: the total is a floor until there is.`}</p>
          ) : null}
          {pay.unpriced.length ? (
            <p>{`Commission not priced for ${pay.unpriced.join(", ")}: give each a rule and a rate.`}</p>
          ) : null}
          {sheet.planned.labour !== null ? (
            <p>{`The plan typed ${money(sheet.planned.labour)} of payroll.`}</p>
          ) : null}
          <ClosedMonthLine
            pay={sheet.lastMonthPay ?? null}
            month={lastMonthName(sheet)}
          />
        </div>
      </SectionCard>

      {(["software", "overhead", "marketing"] as const).map((kind, i) => (
        <CostSheet
          key={kind}
          kind={kind}
          order={2 + i}
          lines={lines.filter(l => l.kind === kind)}
          fx={fx}
          lastCharge={sheet.lastCharge}
          total={
            kind === "software"
              ? software
              : kind === "overhead"
                ? overhead
                : marketing
          }
          spent={
            kind === "software"
              ? spent("software")
              : kind === "marketing"
                ? spent("ads")
                : spent("other") + spent("bank") + spent("courses")
          }
          spentLabel={
            lastMonth
              ? `${lastMonth} on the statements${kind === "marketing" ? " (ads)" : ""}`
              : null
          }
          plannedAds={
            kind === "marketing" && plannedAds
              ? {
                  spend: sheet.planned.spend,
                  retargeting: sheet.planned.spendRetargeting,
                  plan: sheet.plan ? planName(sheet.plan.title) : "plan",
                }
              : null
          }
          onEdit={next =>
            setLines(cur => cur.map(l => (l.id === next.id ? next : l)))
          }
          onCommit={line => void commit(line)}
          onDrop={line => void drop(line)}
          onAdd={() => add(kind)}
          focusId={focusId}
        />
      ))}
    </div>
  );
}

/** "September", the calendar month before the sheet's today. */
function lastMonthName(sheet: Sheet): string {
  const m = sheet.lastMonthPay?.month ?? sheet.statements?.month ?? null;
  return m
    ? new Date(`${m}-01T00:00:00Z`).toLocaleString("en", {
        month: "long",
        timeZone: "UTC",
      })
    : "Last month";
}

/**
 * Last month's base pay as it was approved on Hours and pay, the roster for
 * anyone not approved. The month above stays on roster pay: one unusual
 * month never sets what the next one costs.
 */
function ClosedMonthLine({
  pay,
  month,
}: {
  pay: ClosedMonthPay | null;
  month: string;
}) {
  if (!pay)
    return (
      <p>
        {`${month}'s approved pay could not be read, so it is not compared here. The payroll above is roster pay.`}
      </p>
    );
  const parts = [
    pay.approved
      ? `${month}'s approved pay for ${plural(pay.approved, "person", "people")}`
      : null,
    pay.roster
      ? `roster pay for ${plural(pay.roster, "person", "people")}`
      : null,
  ].filter(Boolean);
  // Nobody counted is "not known", never a $0 month.
  const total = parts.length
    ? `Base pay for ${month}: ${money(pay.total)}, from ${parts.join(" and ")}.`
    : `No base pay for ${month} yet: nobody is approved on Hours and pay or has pay on the roster.`;
  const left = pay.noPay.length
    ? ` It leaves out ${pay.noPay.join(", ")}, with no pay in dollars on the roster, so it is a floor.`
    : "";
  return (
    <>
      <p>{`${total}${left} The month above stays on roster pay.`}</p>
      {pay.noRate.length ? (
        <p>{`No dollar rate for ${pay.noRate.join(", ")}'s approved currency: counted at roster pay.`}</p>
      ) : null}
    </>
  );
}

/** A person's pay a month, typed in their own currency, shown beside its dollars. */
function PayCell({
  person,
  fx,
  onChange,
  onCommit,
}: {
  person: Sheet["people"][number];
  fx: Record<string, number>;
  onChange: (usd: number | null) => void;
  onCommit: (amount: number | null) => void;
}) {
  const rate = fx[person.currency] ?? null;
  const local =
    person.monthlyUsd === null || rate === null
      ? ""
      : String(Math.round((person.monthlyUsd / rate) * 100) / 100);
  const [text, setText] = useState(local);
  // What the server last had, so leaving the cell saves only a real change.
  const saved = useRef(local);
  return (
    <span className="flex items-center justify-end gap-1">
      {person.currency !== "USD" ? (
        <span className="text-xs text-muted-foreground">{person.currency}</span>
      ) : (
        <span className="text-xs text-muted-foreground">$</span>
      )}
      <input
        className={cn(cell, "w-24 text-right")}
        inputMode="decimal"
        aria-label={`${person.name}'s pay a month`}
        placeholder="not set"
        value={text}
        onChange={e => {
          setText(e.target.value);
          const n = Number(e.target.value.replace(/[,\s$]/g, ""));
          onChange(
            e.target.value.trim() === "" || !Number.isFinite(n) || rate === null
              ? null
              : Math.round(n * rate * 100) / 100,
          );
        }}
        onBlur={() => {
          if (text === saved.current) return;
          saved.current = text;
          const n = Number(text.replace(/[,\s$]/g, ""));
          onCommit(text.trim() === "" || !Number.isFinite(n) ? null : n);
        }}
      />
    </span>
  );
}

/** A commission rate: a percent for the share rules, an amount per unit otherwise. */
function RateCell({
  share,
  currency,
  rate,
  label,
  onChange,
  onCommit,
}: {
  share: boolean;
  currency: string;
  rate: number | null;
  label: string;
  onChange: (rate: number | null) => void;
  onCommit: (rate: number | null) => void;
}) {
  const shown =
    rate === null
      ? ""
      : share
        ? String(Math.round(rate * 1000) / 10)
        : String(rate);
  const [text, setText] = useState(shown);
  const saved = useRef(shown);
  const parse = (s: string) => {
    const n = Number(s.replace(/[,\s$%]/g, ""));
    if (s.trim() === "" || !Number.isFinite(n)) return null;
    return share ? n / 100 : n;
  };
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {share ? null : (
        <span className="text-xs text-muted-foreground">{currency}</span>
      )}
      <input
        className={cn(cell, "w-16 text-right")}
        inputMode="decimal"
        aria-label={label}
        value={text}
        onChange={e => {
          setText(e.target.value);
          onChange(parse(e.target.value));
        }}
        onBlur={() => {
          if (text === saved.current) return;
          saved.current = text;
          onCommit(parse(text));
        }}
      />
      {share ? <span className="text-xs text-muted-foreground">%</span> : null}
    </span>
  );
}

function CostSheet({
  kind,
  order,
  lines,
  fx,
  lastCharge,
  total,
  spent,
  spentLabel,
  plannedAds,
  onEdit,
  onCommit,
  onDrop,
  onAdd,
  focusId,
}: {
  /** A row just added, whose name box takes the cursor. */
  focusId: number | null;
  kind: CostKind;
  order: number;
  lines: CostLine[];
  fx: Record<string, number>;
  lastCharge: Sheet["lastCharge"];
  total: { usd: number; lines: number; seats: number; unpriced: string[] };
  spent: number;
  spentLabel: string | null;
  plannedAds: {
    spend: number | null;
    retargeting: number | null;
    plan: string;
  } | null;
  onEdit: (line: CostLine) => void;
  onCommit: (line: CostLine) => void;
  onDrop: (line: CostLine) => void;
  onAdd: () => void;
}) {
  const words = KIND_WORDS[kind];
  const names = useRef(new Map<number, HTMLInputElement>());
  useEffect(() => {
    if (focusId !== null) names.current.get(focusId)?.focus();
  }, [focusId]);
  // Active first, then paused, then cancelled; each in the order it was added.
  const rank = { active: 0, paused: 1, cancelled: 2 } as const;
  const shown = [...lines].sort(
    (a, b) => rank[a.status] - rank[b.status] || a.sort - b.sort || a.id - b.id,
  );
  const set = (line: CostLine, patch: Partial<CostLine>) =>
    onEdit({ ...line, ...patch });
  const num = (s: string): number | null => {
    const n = Number(s.replace(/[,\s$]/g, ""));
    return s.trim() === "" || !Number.isFinite(n) ? null : n;
  };
  return (
    <SectionCard
      title={kind === "marketing" ? "Marketing" : words.title}
      description={words.blurb}
      order={order}
      actions={
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus aria-hidden />
          {words.add}
        </Button>
      }
    >
      {plannedAds ? (
        <div className="mb-3 grid gap-1 border-b pb-3 text-sm">
          <span className={KICKER}>{`From the ${plannedAds.plan}`}</span>
          <div className="flex items-baseline justify-between gap-3">
            <span>Lead-gen ad spend</span>
            <span className="tabular-nums">{money(plannedAds.spend)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span>Retargeting</span>
            <span className="tabular-nums">
              {money(plannedAds.retargeting)}
            </span>
          </div>
        </div>
      ) : null}
      {shown.length ? (
        <div className="ceo-table-scroll -mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 text-left font-medium">
                  {kind === "software" ? "Tool" : "Line"}
                </th>
                <th className="w-32 py-2 text-left font-medium">For</th>
                <th className="w-28 py-2 text-left font-medium">Billed</th>
                <th className="w-20 py-2 text-right font-medium">Seats</th>
                <th className="w-24 py-2 text-right font-medium">Price</th>
                <th className="w-24 py-2 text-right font-medium">A month</th>
                <th className="w-32 py-2 text-left font-medium">Paid with</th>
                <th className="w-28 py-2 text-right font-medium">
                  Last charge
                </th>
                <th className="w-28 py-2 text-left font-medium">Status</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {shown.map(line => {
                const m = monthlyUsd(line, fx);
                const charge = lastCharge[line.id];
                const off = line.status !== "active";
                return (
                  <tr
                    key={line.id}
                    className={cn(
                      "border-b last:border-b-0",
                      off && "text-muted-foreground",
                    )}
                  >
                    <td className="py-0.5">
                      <input
                        className={cn(cell, "font-medium")}
                        ref={el => {
                          if (el) names.current.set(line.id, el);
                          else names.current.delete(line.id);
                        }}
                        aria-label="Name"
                        placeholder={
                          kind === "software" ? "Tool name" : "Line name"
                        }
                        value={line.name}
                        onChange={e => set(line, { name: e.target.value })}
                        onBlur={() => onCommit(line)}
                      />
                    </td>
                    <td className="py-0.5">
                      <input
                        className={cell}
                        aria-label="What it is for"
                        placeholder="AI, CRM, video"
                        value={line.category ?? ""}
                        onChange={e =>
                          set(line, { category: e.target.value || null })
                        }
                        onBlur={() => onCommit(line)}
                      />
                    </td>
                    <td className="py-0.5">
                      <AnimatedSelect
                        aria-label="How it is billed"
                        className="ceo-select-sm w-full"
                        value={line.billing}
                        onChange={e => {
                          const next = {
                            ...line,
                            billing: e.target.value as CostLine["billing"],
                          };
                          onEdit(next);
                          onCommit(next);
                        }}
                      >
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                        <option value="usage">By usage</option>
                      </AnimatedSelect>
                    </td>
                    <td className="py-0.5">
                      <input
                        className={cn(cell, "text-right")}
                        inputMode="numeric"
                        aria-label="Seats"
                        placeholder="flat"
                        value={line.seats === null ? "" : String(line.seats)}
                        onChange={e =>
                          set(line, { seats: num(e.target.value) })
                        }
                        onBlur={() => onCommit(line)}
                      />
                    </td>
                    <td className="py-0.5">
                      <span className="flex items-center">
                        <span className="text-xs text-muted-foreground">
                          {line.currency === "USD" ? "$" : line.currency}
                        </span>
                        <input
                          className={cn(cell, "text-right")}
                          inputMode="decimal"
                          aria-label={
                            line.seats === null ? "Price" : "Price per seat"
                          }
                          value={String(line.unitPrice)}
                          onChange={e =>
                            set(line, { unitPrice: num(e.target.value) ?? 0 })
                          }
                          onBlur={() => onCommit(line)}
                        />
                      </span>
                    </td>
                    <td className="py-0.5 text-right font-medium">
                      {off ? (
                        <span className="text-xs">not counted</span>
                      ) : (
                        <Moving value={money(m)} />
                      )}
                    </td>
                    <td className="py-0.5">
                      <input
                        className={cell}
                        aria-label="Paid with"
                        placeholder="Card"
                        value={line.paidWith ?? ""}
                        onChange={e =>
                          set(line, { paidWith: e.target.value || null })
                        }
                        onBlur={() => onCommit(line)}
                      />
                    </td>
                    <td className="py-0.5 text-right text-xs text-muted-foreground">
                      {charge
                        ? `${money(charge.usd)}, ${shortDate(charge.day)}`
                        : line.match
                          ? "none in 120 days"
                          : ""}
                    </td>
                    <td className="py-0.5">
                      <AnimatedSelect
                        aria-label="Status"
                        className="ceo-select-sm w-full"
                        value={line.status}
                        onChange={e => {
                          const next = {
                            ...line,
                            status: e.target.value as CostLine["status"],
                          };
                          onEdit(next);
                          onCommit(next);
                        }}
                      >
                        <option value="active">Paying</option>
                        <option value="paused">Paused</option>
                        <option value="cancelled">Cancelled</option>
                      </AnimatedSelect>
                    </td>
                    <td className="py-0.5 text-right">
                      <button
                        type="button"
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                        aria-label={`Take ${line.name || "this line"} off the sheet`}
                        title="Take it off the sheet (for a mistake; a tool you stopped is Cancelled)"
                        onClick={() => onDrop(line)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t">
                <td className="pt-2 text-xs text-muted-foreground" colSpan={5}>
                  {`${count(total.lines)} paying${kind === "software" && total.seats ? `, ${count(total.seats)} seats` : ""}${total.unpriced.length ? `; no rate for ${total.unpriced.join(", ")}` : ""}`}
                </td>
                <td className="pt-2 text-right font-semibold">
                  <Moving value={money(total.usd)} />
                </td>
                <td className="pt-2 text-xs text-muted-foreground" colSpan={4}>
                  {spentLabel ? `${spentLabel}: ${money(spent)}` : ""}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <EmptyState title={words.empty} icon={Receipt} compact />
      )}
      {kind === "software" && total.lines && spentLabel ? (
        <p className="mt-2 text-xs text-muted-foreground">
          The statements are the CBK card's only: a tool paid on another card is
          on the sheet and not in the statements' total.
        </p>
      ) : null}
    </SectionCard>
  );
}
