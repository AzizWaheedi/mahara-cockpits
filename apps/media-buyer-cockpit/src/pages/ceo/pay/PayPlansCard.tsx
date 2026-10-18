import { ChevronRight, ListPlus, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { plural } from "@/components/ceo/format";
import { KICKER } from "@/components/ceo/Kicker";
import { SectionCard } from "@/components/ceo/SectionCard";
import { Button } from "@/components/ui/button";
import { api, useAction } from "@/lib/cockpitApi";
import {
  type PayPlanRow,
  type PayPlansList,
  planFor,
  planSentence,
} from "@/types/ceo/payPlan";
import { errorText } from "./fields";
import {
  monthShortYear,
  personPlanLine,
  rolePlanRow,
  thisMonth,
} from "./payCopy";

/**
 * Pay plans on Team & payroll (PAY-PLANS.md 8.1), between Hours and pay and
 * On the team: one row per role plan, the way the scorecard templates are
 * listed, each opening the plan sheet. People follow their role's plan
 * unless they have their own, so adding someone is picking a role.
 */

/** The plans list, read once for the tab and again after a save. */
export function usePayPlans(): {
  plans: PayPlansList | null;
  error: string | null;
  reload: () => Promise<void>;
} {
  const read = useAction(api.ceo.pay.list);
  const [plans, setPlans] = useState<PayPlansList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setPlans((await read({})) as PayPlansList);
      setError(null);
    } catch (e) {
      setError(errorText(e, "The pay plans could not be read."));
    }
  }, [read]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { plans, error, reload };
}

/** The role plans in force this month, plus any that start later, one row per role. */
export function rolePlanRows(
  plans: PayPlansList,
  month: string,
): { row: PayPlanRow; later: boolean }[] {
  const roles = new Map<string, PayPlanRow[]>();
  for (const r of plans.plans) {
    if (r.role === null || !r.plan) continue;
    const k = r.role.trim().toLowerCase();
    roles.set(k, [...(roles.get(k) ?? []), r]);
  }
  const out: { row: PayPlanRow; later: boolean }[] = [];
  for (const rows of roles.values()) {
    const now = rolePlanRow(plans, rows[0].role, month);
    if (now) out.push({ row: now, later: false });
    else {
      const first = [...rows].sort((a, b) =>
        a.fromMonth.localeCompare(b.fromMonth),
      )[0];
      out.push({ row: first, later: true });
    }
  }
  return out.sort((a, b) => (a.row.role ?? "").localeCompare(b.row.role ?? ""));
}

/** "Media buyer · bonus by cost per lead, up to $400 · 1 person · from Oct 2026". */
export function rolePlanLine(
  plans: PayPlansList,
  row: PayPlanRow,
  month: string,
): string {
  const following = plans.people.filter(
    p =>
      p.active &&
      planFor(plans.plans, p, `${month}-01`).source === "role" &&
      (p.role ?? "").trim().toLowerCase() ===
        (row.role ?? "").trim().toLowerCase(),
  ).length;
  return [
    row.role,
    planSentence(row.plan),
    plural(following, "person", "people"),
    `from ${monthShortYear(row.fromMonth)}`,
  ].join(" · ");
}

export function PayPlansCard({
  plans,
  error,
  onRetry,
  onOpenRole,
  onOpenPerson,
  order = 2,
}: {
  plans: PayPlansList | null;
  error: string | null;
  onRetry: () => void;
  /** Open a role's plan; null for a new role plan. */
  onOpenRole: (role: string | null) => void;
  onOpenPerson: (person: {
    id: number;
    name: string;
    role: string | null;
  }) => void;
  order?: number;
}) {
  const month = thisMonth();
  const rows = plans ? rolePlanRows(plans, month) : [];
  const own = plans
    ? plans.people.filter(
        p =>
          p.active && planFor(plans.plans, p, `${month}-01`).source === "own",
      )
    : [];
  return (
    <SectionCard
      id="team-pay-plans"
      title="Pay plans"
      description="Commission and bonuses on top of the base. People follow their role's plan unless they have their own."
      order={order}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!plans}
          onClick={() => onOpenRole(null)}
        >
          <Plus aria-hidden /> Plan for a role
        </Button>
      }
    >
      {() =>
        error && !plans ? (
          <EmptyState
            title={error}
            text="Nothing was changed. Try again; if it keeps failing the pay plans are not set up on the database yet."
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
              >
                <RefreshCw aria-hidden /> Try again
              </Button>
            }
            compact
          />
        ) : !plans ? (
          <p className="text-sm text-muted-foreground">Reading the pay plans</p>
        ) : rows.length === 0 && own.length === 0 ? (
          <EmptyState
            icon={ListPlus}
            title="No role plans yet"
            text="A role plan pays everyone with that role the same way: a bonus by band, an amount per event, a share of money. Start with one role."
            action={
              <Button type="button" size="sm" onClick={() => onOpenRole(null)}>
                <Plus aria-hidden /> Plan for a role
              </Button>
            }
            compact
          />
        ) : (
          <div className="grid gap-4">
            <ul className="divide-y">
              {rows.map(({ row, later }) => (
                <li key={row.id}>
                  <PlanRowButton
                    text={rolePlanLine(
                      plans,
                      row,
                      later ? row.fromMonth : month,
                    )}
                    note={later ? "Starts later" : null}
                    meta={2}
                    onClick={() => onOpenRole(row.role)}
                  />
                </li>
              ))}
            </ul>
            {own.length ? (
              <div className="grid gap-1">
                <span className={KICKER}>Own plans</span>
                <ul className="divide-y">
                  {own.map(p => (
                    <li key={p.id}>
                      <PlanRowButton
                        text={`${p.name} · ${personPlanLine(plans, p, month).words}`}
                        note={null}
                        meta={0}
                        onClick={() => onOpenPerson(p)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {error ? (
              <p className="text-xs text-[var(--ceo-critical)]">{error}</p>
            ) : null}
          </div>
        )
      }
    </SectionCard>
  );
}

function PlanRowButton({
  text,
  note,
  meta,
  onClick,
}: {
  text: string;
  note: string | null;
  /** How many trailing parts of the line are quiet facts (people, month). */
  meta: number;
  onClick: () => void;
}) {
  // The role leads, the plan in words under it, the facts on the right.
  const parts = text.split(" · ");
  const head = parts[0];
  const facts = meta ? parts.slice(-meta) : [];
  const said = parts.slice(1, meta ? -meta : undefined).join(" · ");
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-1 py-3 text-left text-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="grid min-w-0 gap-0.5 @2xl:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] @2xl:items-baseline @2xl:gap-x-4">
        <span className="font-medium">
          {head}
          {note ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {note}
            </span>
          ) : null}
        </span>
        <span className="line-clamp-2 text-muted-foreground">{said}</span>
        {facts.length ? (
          <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground tabular-nums">
            {facts.join(" · ")}
          </span>
        ) : null}
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </button>
  );
}

/**
 * The line under a person's commission on the roster (8.4): their plan in
 * words and the link that opens it, "Edit pay plan" or "Add a pay plan".
 */
export function PersonPlanLine({
  plans,
  error,
  person,
  onOpen,
}: {
  plans: PayPlansList | null;
  error: string | null;
  person: { id: number; name: string; role: string | null };
  onOpen: () => void;
}) {
  if (!plans)
    return (
      <p className="text-xs text-muted-foreground">
        {error ? "Pay plan: n/a, the plans could not be read" : null}
      </p>
    );
  const line = personPlanLine(plans, person, thisMonth());
  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
      <span className="min-w-0">{line.words}</span>
      <button
        type="button"
        onClick={onOpen}
        className="rounded-sm font-medium text-foreground/80 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${line.source === "none" ? "Add a pay plan" : "Edit pay plan"} for ${person.name}`}
      >
        {line.source === "none" ? "Add a pay plan" : "Edit pay plan"}
      </button>
    </p>
  );
}
