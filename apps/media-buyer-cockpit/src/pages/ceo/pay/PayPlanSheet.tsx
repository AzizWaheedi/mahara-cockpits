import {
  ArrowDown,
  ArrowUp,
  Check,
  ListPlus,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { money, shortDate } from "@/components/ceo/format";
import { KICKER } from "@/components/ceo/Kicker";
import { StatusChip } from "@/components/ceo/StatusChip";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api, useAction } from "@/lib/cockpitApi";
import { cn } from "@/lib/utils";
import { type CommissionBasis, SHARE_BASES } from "@/types/ceo/commission";
import {
  BAND_METRIC,
  type BandMetric,
  type BandPart,
  checkPlan,
  EVENTS,
  type EventKey,
  type FloorPart,
  PART_KIND_LABEL,
  type Part,
  type PayMonth,
  type PayPlanRow,
  type PayPlansList,
  type PerAbovePart,
  type PerEventPart,
  type Plan,
  type PlanCommission,
  partSentence,
  planCommissionText,
  planFor,
  SHARE_OF,
  SHARE_OF_LABEL,
  type ShareOf,
  type SharePart,
  type Step,
  TYPED_EVENTS,
} from "@/types/ceo/payPlan";
import { BandEditor, BandRuler, type RulerMark } from "./BandRuler";
import {
  CheckRow,
  commissionOptions,
  errorText,
  FIELD,
  LABEL,
  NumberBox,
} from "./fields";
import {
  type AlsoLine,
  KIND_NOTE,
  labelNamesOther,
  monthName,
  monthShortYear,
  monthYear,
  nextMonth,
  ownCopy,
  PART_TEMPLATES,
  planPartOf,
  renameForMetric,
  rolePlanRow,
  thisMonth,
  uniqueKey,
} from "./payCopy";

/**
 * The pay plan sheet (PAY-PLANS.md 8.2): a role's plan, or one person's. A
 * person first says whether they follow their role's plan or have their own;
 * an own plan starts as a copy of the role's. Parts are cards, one editor per
 * kind; the band parts carry the ruler. Every keystroke runs the server's
 * own check (checkPlan), so the line at the foot is either what is wrong or
 * "Not saved yet."; the plan saves as a whole, from a month, with Save the
 * pay plan. The server's refusal is shown as it is said.
 */

export type PlanScope =
  | { kind: "role"; role: string | null }
  | { kind: "person"; personId: number; name: string; role: string | null };

type Mode = "follow" | "own";
type Draft = {
  mode: Mode;
  role: string;
  parts: Part[];
  commission: PlanCommission[];
};

const isRoleScope = (s: PlanScope) => s.kind === "role";

/** The stored row the sheet starts from: in force this month, else the first one ahead. */
function startingRow(
  plans: PayPlansList,
  scope: PlanScope,
  month: string,
): PayPlanRow | null {
  const m0 = `${month}-01`;
  const mine =
    scope.kind === "role"
      ? plans.plans.filter(
          r =>
            r.role !== null &&
            scope.role !== null &&
            r.role.trim().toLowerCase() === scope.role.trim().toLowerCase(),
        )
      : plans.plans.filter(r => r.personId === scope.personId);
  const sorted = [...mine].sort((a, b) =>
    a.fromMonth.localeCompare(b.fromMonth),
  );
  return (
    [...sorted].reverse().find(r => r.fromMonth.slice(0, 10) <= m0) ??
    sorted[0] ??
    null
  );
}

function initialDraft(
  plans: PayPlansList,
  scope: PlanScope,
  month: string,
): Draft {
  if (scope.kind === "role") {
    const row = startingRow(plans, scope, month);
    return {
      mode: "own",
      role: scope.role ?? "",
      parts: structuredClone(row?.plan?.parts ?? []),
      commission: structuredClone(row?.plan?.commission ?? []),
    };
  }
  const pf = planFor(
    plans.plans,
    { id: scope.personId, role: scope.role },
    `${month}-01`,
  );
  const rolePlan = rolePlanRow(plans, scope.role, month)?.plan ?? null;
  if (pf.source === "own")
    return {
      mode: "own",
      role: scope.role ?? "",
      parts: structuredClone(pf.plan?.parts ?? []),
      commission: [],
    };
  return {
    mode: rolePlan ? "follow" : "own",
    role: scope.role ?? "",
    parts: ownCopy(rolePlan).parts,
    commission: [],
  };
}

/** The plan the draft saves: null on a person who follows the role plan. */
function planOf(scope: PlanScope, d: Draft): Plan | null {
  if (scope.kind === "person" && d.mode === "follow") return null;
  return {
    version: 1,
    parts: d.parts,
    ...(scope.kind === "role" && d.commission.length
      ? { commission: d.commission }
      : {}),
  };
}

/** The months a plan can start from: the first one nobody it touches is approved in, and five after. */
function fromMonths(
  plans: PayPlansList,
  scope: PlanScope,
  today: string,
): string[] {
  const roleKey = (r: string | null | undefined) =>
    (r ?? "").trim().toLowerCase();
  const affected =
    scope.kind === "person"
      ? [scope.personId]
      : plans.people
          .filter(p => scope.role && roleKey(p.role) === roleKey(scope.role))
          .map(p => p.id);
  const approved = plans.lastApproved
    .filter(a => affected.includes(a.personId))
    .map(a => a.month.slice(0, 7))
    .sort()
    .at(-1);
  let first = today;
  if (approved && approved >= first) first = nextMonth(approved);
  const out = [first];
  for (let i = 0; i < 5; i++) out.push(nextMonth(out[out.length - 1]));
  return out;
}

/** Whose month a part's ticks read: the person, or each person following the role plan. */
function peopleFor(
  month: PayMonth,
  scope: PlanScope,
  rowId: number | null,
): PayMonth["people"] {
  return scope.kind === "person"
    ? month.people.filter(p => p.personId === scope.personId)
    : month.people.filter(
        p =>
          p.plan.source === "role" && rowId !== null && p.plan.planId === rowId,
      );
}

/** The band part a person's month was worked out on (its metric, clients and guard). */
function workedOn(
  plans: PayPlansList | null,
  p: PayMonth["people"][number],
  key: string,
): BandPart | null {
  const part = planPartOf(plans, p, key);
  return part?.kind === "band" ? part : null;
}

const sameGuard = (a?: BandPart["guard"], b?: BandPart["guard"]) =>
  (a?.minClients ?? null) === (b?.minClients ?? null) &&
  (a?.minSpendUsd ?? null) === (b?.minSpendUsd ?? null) &&
  (a?.excludeDays ?? null) === (b?.excludeDays ?? null);

/**
 * This month's value of a part, for the ruler's tick, on the metric the
 * ruler is drawn in: the month's own value when the part was worked out on
 * that metric; after a switch between cost per lead and cost per booking, the
 * other metric the month tracked over the same clients and guard; else none,
 * never a cost per lead placed on a cost-per-booking scale.
 */
export function marksFor(
  month: PayMonth | null,
  plans: PayPlansList | null,
  scope: PlanScope,
  rowId: number | null,
  part: BandPart,
): RulerMark[] {
  if (!month) return [];
  const short = monthName(month.month).slice(0, 3);
  const people = peopleFor(month, scope, rowId);
  const marks: RulerMark[] = [];
  for (const p of people) {
    const input = p.parts.find(x => x.key === part.key)?.input;
    if (!input) continue;
    const was = workedOn(plans, p, part.key)?.metric ?? null;
    const v =
      was === null || was === part.metric
        ? input.value
        : input.alsoTracked?.metric === part.metric
          ? input.alsoTracked.value
          : null;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (marks.some(m => m.value === v)) continue;
    marks.push({
      value: v,
      label:
        scope.kind === "role" && people.length > 1
          ? `${p.name.split(" ")[0]} · ${short}`
          : short,
    });
  }
  return marks.slice(0, 3);
}

/**
 * The other money metric this month, tracked and not paid on: the facts'
 * pooled figure for a part that counts every client with no guard; for a
 * part that counts fewer clients or has a guard, each person's figure over
 * the same clients and guard (cockpit_pay_band_input's alsoTracked), and the
 * pooled figure said as every client's when the month has none.
 */
export function alsoFor(
  month: PayMonth | null,
  plans: PayPlansList | null,
  scope: PlanScope,
  rowId: number | null,
  part: BandPart,
): AlsoLine | null {
  const metric = part.metric;
  if (!month || (metric !== "cpl" && metric !== "cpb")) return null;
  const other: BandMetric = metric === "cpl" ? "cpb" : "cpl";
  const ym = month.month.slice(0, 7);
  const ads = (month.facts as Record<string, unknown> | null)?.ads as
    | { pooled?: Record<string, unknown> }
    | null
    | undefined;
  const v = ads?.pooled?.[other];
  const pooled = typeof v === "number" && Number.isFinite(v) ? v : null;
  if ((part.covers ?? "all_clients") === "all_clients" && !part.guard)
    return {
      metric: other,
      month: ym,
      over: "every_client",
      values: [{ who: null, value: pooled }],
    };
  const people = peopleFor(month, scope, rowId);
  const values: AlsoLine["values"] = [];
  for (const p of people) {
    const input = p.parts.find(x => x.key === part.key)?.input;
    const was = workedOn(plans, p, part.key);
    if (
      !input ||
      !was ||
      (was.covers ?? "all_clients") !== (part.covers ?? "all_clients") ||
      !sameGuard(was.guard, part.guard)
    )
      continue;
    const who = people.length > 1 ? p.name.split(" ")[0] : null;
    if (was.metric === metric && input.alsoTracked?.metric === other)
      values.push({
        who,
        value: input.alsoTracked.value,
        note: input.alsoTracked.note,
      });
    else if (was.metric === other)
      values.push({ who, value: input.value, note: input.note });
  }
  if (!values.length)
    return {
      metric: other,
      month: ym,
      over: "every_client_only",
      values: [{ who: null, value: pooled }],
    };
  return { metric: other, month: ym, over: "same", values };
}

export function PayPlanSheet({
  scope,
  plans,
  month,
  base,
  onClose,
  onSaved,
  onOpenRole,
}: {
  /** What is being edited; null closes the sheet. */
  scope: PlanScope | null;
  plans: PayPlansList | null;
  /** This month's pay, for the ruler's tick and "Also tracked"; null while it loads. */
  month: PayMonth | null;
  /** The person's base, read from the row ("base $700 a month"). */
  base?: { usd: number | null; currency: string } | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  /** Open the role's plan instead (from a person who follows it). */
  onOpenRole?: (role: string) => void;
}) {
  return (
    <Sheet open={scope !== null} onOpenChange={o => (o ? null : onClose())}>
      <SheetContent
        side="right"
        // ceo-root: the sheet sits in a portal outside the tokens. The body
        // scrolls inside, so the close button and the save row stay put;
        // overflow-clip, not hidden, so focusing a field deep in the form
        // cannot scroll the whole sheet and push the header off the top.
        className="ceo-root flex w-full max-w-none flex-col gap-0 overflow-clip p-0 sm:max-w-2xl"
      >
        {scope && plans ? (
          <SheetBody
            key={
              scope.kind === "role"
                ? `role:${scope.role ?? ""}`
                : `person:${scope.personId}`
            }
            scope={scope}
            plans={plans}
            month={month}
            base={base ?? null}
            onClose={onClose}
            onSaved={onSaved}
            onOpenRole={onOpenRole}
          />
        ) : scope ? (
          <div className="p-6 text-sm text-muted-foreground">
            The pay plans have not loaded. Close this and open it again in a
            minute.
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({
  scope,
  plans,
  month,
  base,
  onClose,
  onSaved,
  onOpenRole,
}: {
  scope: PlanScope;
  plans: PayPlansList;
  month: PayMonth | null;
  base: { usd: number | null; currency: string } | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onOpenRole?: (role: string) => void;
}) {
  const savePlan = useAction(api.ceo.pay.savePlan);
  const id = useId();
  const today = thisMonth();
  const [start] = useState(() => initialDraft(plans, scope, today));
  const [d, setD] = useState<Draft>(start);
  const [saved, setSaved] = useState<Draft>(start);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState("");
  const draftRole = d.role.trim() || null;
  const months = useMemo(
    () =>
      fromMonths(
        plans,
        scope.kind === "role" ? { kind: "role", role: draftRole } : scope,
        today,
      ),
    [plans, scope, draftRole, today],
  );
  const [from, setFrom] = useState(months[0]);
  const [typo, setTypo] = useState(false);
  useEffect(() => {
    if (!months.includes(from)) setFrom(months[0]);
  }, [months, from]);

  const row =
    scope.kind === "role" && !scope.role
      ? null
      : startingRow(plans, scope, today);
  const rolePlan = rolePlanRow(plans, scope.role, today);
  const usedByApproval = row ? plans.approvedPlanIds.includes(row.id) : false;
  const plan = planOf(scope, d);
  const isRole = isRoleScope(scope);
  const fault =
    scope.kind === "role" && !d.role.trim()
      ? "Choose the role this plan is for."
      : plan === null
        ? null
        : checkPlan(plan, { isRole });
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const applyFrom = typo && row ? row.fromMonth.slice(0, 7) : from;

  const setPart = (i: number, next: Part) =>
    setD(v => ({ ...v, parts: v.parts.map((p, n) => (n === i ? next : p)) }));
  const move = (i: number, by: number) =>
    setD(v => {
      const n = i + by;
      if (n < 0 || n >= v.parts.length) return v;
      const parts = [...v.parts];
      [parts[i], parts[n]] = [parts[n], parts[i]];
      return { ...v, parts };
    });
  const remove = (i: number) =>
    setD(v => ({ ...v, parts: v.parts.filter((_, n) => n !== i) }));
  const add = (templateId: string) => {
    const t = PART_TEMPLATES.find(x => x.id === templateId);
    if (!t) return;
    setD(v => {
      const made = t.make();
      const key = uniqueKey(
        made,
        v.parts.map(p => p.key),
      );
      return {
        ...v,
        mode: "own",
        parts: [...v.parts, { ...made, key } as Part],
      };
    });
  };

  const save = async () => {
    if (fault) return;
    setBusy(true);
    setMsg(null);
    try {
      await savePlan({
        ...(scope.kind === "role"
          ? { role: d.role.trim() }
          : { personId: scope.personId }),
        fromMonth: applyFrom,
        plan,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setSaved(d);
      setTypo(false);
      setNote("");
      setMsg({
        ok: true,
        text: `Pay plan saved. It counts from ${monthYear(applyFrom)}, paid with ${monthName(nextMonth(applyFrom))}'s payroll.`,
      });
      await onSaved();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e, "The pay plan was not saved.") });
    } finally {
      setBusy(false);
    }
  };

  const title =
    scope.kind === "role"
      ? scope.role
        ? `${scope.role} plan`
        : "A new role plan"
      : `${scope.name}'s pay plan`;
  const baseWords = base
    ? base.usd === null
      ? "no base set"
      : `base ${money(base.usd)} a month`
    : null;
  const description =
    scope.kind === "role"
      ? "Everyone with this role follows it, unless they have their own plan. Bases stay on the roster."
      : `${scope.role ?? "No role"}${baseWords ? ` · ${baseWords}, changed on the row` : ""}.`;
  const rowId = scope.kind === "role" ? (row?.id ?? null) : null;

  return (
    <>
      <SheetHeader
        className="shrink-0 border-b p-5 pr-14 pt-safe"
        style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}
      >
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
        {row ? (
          <p className="text-xs text-muted-foreground">
            {`In force from ${monthYear(row.fromMonth)} · changed ${shortDate(row.setAt.slice(0, 10))} by the CEO`}
          </p>
        ) : null}
      </SheetHeader>

      <div className="@container flex-1 overflow-y-auto p-5 pb-16">
        <div className="grid gap-6">
          {scope.kind === "role" && !scope.role ? (
            <label className="grid gap-1">
              <span className={LABEL}>The role</span>
              <input
                list={`${id}-roles`}
                value={d.role}
                onChange={e => setD(v => ({ ...v, role: e.target.value }))}
                placeholder="Media buyer"
                aria-label="The role this plan is for"
                className={cn(FIELD, "w-full max-w-sm")}
              />
              <datalist id={`${id}-roles`}>
                {plans.roles.map(r => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              <span className="text-xs text-muted-foreground">
                The role as the roster has it. Everyone with it follows this
                plan.
              </span>
            </label>
          ) : null}

          {scope.kind === "person" ? (
            <fieldset className="grid gap-2">
              <legend className={cn(KICKER, "mb-2")}>Their pay plan</legend>
              <div className="grid gap-2 @md:grid-cols-2">
                <Choice
                  name={`${id}-mode`}
                  checked={d.mode === "follow"}
                  disabled={!rolePlan}
                  onSelect={() => setD(v => ({ ...v, mode: "follow" }))}
                  title={
                    rolePlan
                      ? `Follows the ${rolePlan.role} plan · role`
                      : scope.role
                        ? `No plan for ${scope.role} yet`
                        : "No role on the roster"
                  }
                  text={
                    rolePlan
                      ? "Changes to the role plan reach them too."
                      : "Give the role a plan, or give them their own."
                  }
                />
                <Choice
                  name={`${id}-mode`}
                  checked={d.mode === "own"}
                  onSelect={() => setD(v => ({ ...v, mode: "own" }))}
                  title="Own plan"
                  text={
                    rolePlan
                      ? `Starts as a copy of the ${rolePlan.role} plan.`
                      : "Built here, part by part."
                  }
                />
              </div>
            </fieldset>
          ) : null}

          {scope.kind === "person" && d.mode === "follow" && rolePlan?.plan ? (
            <section className="grid gap-3">
              <span className={KICKER}>{`${rolePlan.role} plan`}</span>
              {rolePlan.plan.parts.length ? (
                rolePlan.plan.parts.map(p => (
                  <div key={p.key} className="grid gap-3 rounded-xl border p-4">
                    <span className={KICKER}>{PART_KIND_LABEL[p.kind]}</span>
                    {p.kind === "band" ? (
                      <BandRuler
                        part={p}
                        marks={marksFor(month, plans, scope, null, p)}
                      />
                    ) : null}
                    <p className="text-sm">{partSentence(p)}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  The role plan has no parts: pay is the base and the commission
                  lines on the row.
                </p>
              )}
              {(rolePlan.plan.commission ?? []).length ? (
                <p className="text-xs text-muted-foreground">
                  {`Commission picked with the role: ${(rolePlan.plan.commission ?? []).map(planCommissionText).join(" + ")}. Their own lines are on the row.`}
                </p>
              ) : null}
              {onOpenRole && rolePlan.role ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => onOpenRole(rolePlan.role as string)}
                >
                  {`Edit the ${rolePlan.role} plan`}
                </Button>
              ) : null}
            </section>
          ) : (
            <section className="grid gap-3" aria-label="Parts">
              <span className={KICKER}>Parts</span>
              {d.parts.length ? (
                d.parts.map((p, i) => (
                  <PartCard
                    key={p.key}
                    part={p}
                    index={i}
                    count={d.parts.length}
                    isRole={isRole}
                    marks={
                      p.kind === "band"
                        ? marksFor(month, plans, scope, rowId, p)
                        : []
                    }
                    also={
                      p.kind === "band"
                        ? alsoFor(month, plans, scope, rowId, p)
                        : null
                    }
                    disabled={busy}
                    onChange={next => setPart(i, next)}
                    onMove={by => move(i, by)}
                    onRemove={() => remove(i)}
                  />
                ))
              ) : (
                <EmptyState
                  icon={ListPlus}
                  title="No pay plan yet"
                  text="Pay is the base alone. Add a part: a bonus, a commission, or a count you type each month."
                  compact
                />
              )}
              <AddPart onAdd={add} disabled={busy} />
            </section>
          )}

          {scope.kind === "role" ? (
            <CommissionDefaults
              lines={d.commission}
              disabled={busy}
              onChange={commission => setD(v => ({ ...v, commission }))}
            />
          ) : null}

          <Versions plans={plans} scope={scope} />
        </div>
      </div>

      <div
        className="shrink-0 border-t bg-card p-4"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        {/* When and why only matter once something changed. */}
        {dirty ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {typo && row ? (
                <span className="text-xs text-muted-foreground">
                  {`Replaces the plan from ${monthYear(row.fromMonth)}`}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">Applies from</span>
                  <AnimatedSelect
                    value={from}
                    disabled={busy}
                    onChange={e => setFrom(e.target.value)}
                    aria-label="The month the plan applies from"
                    className="ceo-select-sm w-40"
                  >
                    {months.map(m => (
                      <option key={m} value={m}>
                        {monthYear(m)}
                      </option>
                    ))}
                  </AnimatedSelect>
                </span>
              )}
              {row ? (
                <CheckRow
                  checked={typo}
                  disabled={busy || usedByApproval}
                  onChange={setTypo}
                  className="gap-1.5 text-xs text-muted-foreground"
                >
                  {usedByApproval
                    ? "Fix a typo (not here: an approved month used this plan)"
                    : "Fix a typo (replace this plan)"}
                </CheckRow>
              ) : null}
            </div>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="A note for the record (optional)"
              aria-label="A note for the record"
              className={cn(FIELD, "mt-3 w-full")}
              maxLength={300}
            />
          </>
        ) : null}
        <div
          className={cn("flex flex-wrap items-center gap-2", dirty && "mt-3")}
        >
          <Button
            type="button"
            disabled={busy || !dirty || fault !== null}
            onClick={() => void save()}
          >
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Check aria-hidden />
            )}
            Save the pay plan
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {dirty ? "Cancel" : "Close"}
          </Button>
        </div>
        <p
          aria-live="polite"
          className={cn(
            "mt-2 min-h-4 text-xs",
            (msg && !msg.ok) || (dirty && fault)
              ? "text-[var(--ceo-critical)]"
              : "text-muted-foreground",
          )}
        >
          {msg && (!dirty || !msg.ok)
            ? msg.text
            : dirty
              ? (fault ?? "Not saved yet.")
              : null}
        </p>
      </div>
    </>
  );
}

/** One of the two choices a person has: follow the role plan, or their own. */
function Choice({
  name,
  checked,
  disabled,
  onSelect,
  title,
  text,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  text: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring",
        checked && "border-[var(--ceo-emphasis)] bg-[var(--ceo-emphasis-wash)]",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 size-4 shrink-0"
      />
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{text}</span>
      </span>
    </label>
  );
}

/** "Add a part": one select, grouped by kind, each option a part with sensible first numbers. */
function AddPart({
  onAdd,
  disabled,
}: {
  onAdd: (templateId: string) => void;
  disabled?: boolean;
}) {
  const groups = [...new Set(PART_TEMPLATES.map(t => t.group))];
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Plus className="size-4 text-muted-foreground" aria-hidden />
      <AnimatedSelect
        value=""
        disabled={disabled}
        onChange={e => e.target.value && onAdd(e.target.value)}
        aria-label="Add a part"
        className="ceo-select-sm min-w-0 max-w-full"
      >
        <option value="">Add a part</option>
        {groups.map(g => (
          <optgroup key={g} label={g}>
            {PART_TEMPLATES.filter(t => t.group === g).map(t => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </optgroup>
        ))}
      </AnimatedSelect>
    </span>
  );
}

/** A part as a card: its kind, its name on the receipt, its editor, and its sentence (or what is wrong with it). */
function PartCard({
  part,
  index,
  count,
  isRole,
  marks,
  also,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  part: Part;
  index: number;
  count: number;
  isRole: boolean;
  marks: RulerMark[];
  also: AlsoLine | null;
  disabled?: boolean;
  onChange: (next: Part) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const fault = checkPlan({ version: 1, parts: [part] }, { isRole });
  // A money bonus whose name still says the other metric (after a switch, or typed so).
  const misnamed = labelNamesOther(part);
  let body: ReactNode;
  switch (part.kind) {
    case "band":
      body = (
        <BandEditor
          part={part}
          onChange={next => onChange(next)}
          marks={marks}
          also={also}
          disabled={disabled}
        />
      );
      break;
    case "per_event":
      body = (
        <PerEventFields part={part} onChange={onChange} disabled={disabled} />
      );
      break;
    case "share":
      body = (
        <ShareFields part={part} onChange={onChange} disabled={disabled} />
      );
      break;
    case "per_above":
      body = (
        <PerAboveFields part={part} onChange={onChange} disabled={disabled} />
      );
      break;
    case "floor":
      body = (
        <FloorFields part={part} onChange={onChange} disabled={disabled} />
      );
      break;
  }
  return (
    <article className="@container grid gap-4 rounded-xl border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className={KICKER}>{PART_KIND_LABEL[part.kind]}</span>
        <span className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            disabled={disabled || index === 0}
            onClick={() => onMove(-1)}
            aria-label={`Move ${part.label} up`}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            disabled={disabled || index === count - 1}
            onClick={() => onMove(1)}
            aria-label={`Move ${part.label} down`}
          >
            <ArrowDown aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Remove ${part.label}`}
          >
            <Trash2 aria-hidden />
          </Button>
        </span>
      </header>
      <label className="grid gap-1">
        <span className={LABEL}>Name on the receipt</span>
        <input
          value={part.label}
          disabled={disabled}
          onChange={e => onChange({ ...part, label: e.target.value })}
          aria-label={`Name of part ${index + 1} on the receipt`}
          className={cn(
            FIELD,
            "w-full max-w-md",
            misnamed && "ring-2 ring-[var(--ceo-warning)]",
          )}
          maxLength={80}
        />
      </label>
      {misnamed && part.kind === "band" ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {`The name says ${BAND_METRIC[misnamed].label.toLowerCase()}; this part is paid on ${BAND_METRIC[part.metric].label.toLowerCase()}. Rename it?`}
          {renameForMetric(part.label, misnamed, part.metric) !== part.label ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...part,
                  label: renameForMetric(part.label, misnamed, part.metric),
                })
              }
            >
              {`Use "${renameForMetric(part.label, misnamed, part.metric)}"`}
            </Button>
          ) : null}
        </p>
      ) : null}
      {body}
      {KIND_NOTE[part.kind] ? (
        <p className="text-xs text-muted-foreground">{KIND_NOTE[part.kind]}</p>
      ) : null}
      <p
        className={cn(
          "border-t pt-3 text-xs",
          fault ? "text-[var(--ceo-critical)]" : "text-muted-foreground",
        )}
      >
        {fault ?? partSentence(part)}
      </p>
    </article>
  );
}

function PerEventFields({
  part,
  onChange,
  disabled,
}: {
  part: PerEventPart;
  onChange: (next: Part) => void;
  disabled?: boolean;
}) {
  const setEvent = (event: EventKey) => {
    const { eventLabel: _l, ...rest } = part;
    onChange(
      event === "custom"
        ? { ...rest, event, eventLabel: part.eventLabel ?? "Thing counted" }
        : { ...rest, event },
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
      <NumberBox
        value={part.amount}
        onChange={amount => onChange({ ...part, amount })}
        label={`What ${part.label} pays each`}
        prefix="$"
        width="w-24"
        disabled={disabled}
      />
      <span className="text-muted-foreground">for each</span>
      <AnimatedSelect
        value={part.event}
        disabled={disabled}
        onChange={e => setEvent(e.target.value as EventKey)}
        aria-label={`What ${part.label} counts`}
        className="ceo-select-sm min-w-0 max-w-full"
      >
        <optgroup label="Typed by you each month">
          {TYPED_EVENTS.map(e => (
            <option key={e} value={e}>
              {EVENTS[e].label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Counted by the cockpit">
          <option value="pif_deal_closed">
            {EVENTS.pif_deal_closed.label}
          </option>
        </optgroup>
      </AnimatedSelect>
      {part.event === "custom" ? (
        <input
          value={part.eventLabel ?? ""}
          disabled={disabled}
          onChange={e => onChange({ ...part, eventLabel: e.target.value })}
          placeholder="What is counted"
          aria-label={`What ${part.label} counts, in words`}
          className={cn(FIELD, "w-48 max-w-full")}
          maxLength={80}
        />
      ) : null}
    </div>
  );
}

function ShareFields({
  part,
  onChange,
  disabled,
}: {
  part: SharePart;
  onChange: (next: Part) => void;
  disabled?: boolean;
}) {
  const setSteps = (steps: Step[]) => onChange({ ...part, steps });
  const setEnds = (onCancel: boolean, lapseDays: number | undefined) => {
    const { ends: _e, ...rest } = part;
    if (!onCancel && lapseDays === undefined) onChange(rest);
    else
      onChange({
        ...rest,
        ends: { onCancel, ...(lapseDays === undefined ? {} : { lapseDays }) },
      });
  };
  const lapse = part.ends?.lapseDays;
  return (
    <div className="grid gap-3 text-sm">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">A share of</span>
        <AnimatedSelect
          value={part.of}
          disabled={disabled}
          onChange={e => onChange({ ...part, of: e.target.value as ShareOf })}
          aria-label={`What ${part.label} is a share of`}
          className="ceo-select-sm min-w-0 max-w-full"
        >
          {SHARE_OF.map(o => (
            <option key={o} value={o}>
              {SHARE_OF_LABEL[o]}
            </option>
          ))}
        </AnimatedSelect>
        <span className="text-xs text-muted-foreground">
          typed by you each month
        </span>
      </span>
      <div className="grid gap-1.5">
        <span className={LABEL}>By month of the engagement</span>
        {part.steps.map((s, i) => (
          <span key={i} className="flex flex-wrap items-center gap-2">
            {i === 0 ? (
              <span className="w-32 text-muted-foreground">From month 1</span>
            ) : (
              <span className="flex w-32 items-center gap-1 text-muted-foreground">
                From month
                <NumberBox
                  value={s.fromMonth}
                  onChange={fromMonth =>
                    setSteps(
                      part.steps.map((x, n) =>
                        n === i ? { ...x, fromMonth } : x,
                      ),
                    )
                  }
                  label={`The month step ${i + 1} of ${part.label} starts`}
                  width="w-14"
                  integer
                  disabled={disabled}
                />
              </span>
            )}
            <NumberBox
              value={s.rate}
              scale={100}
              onChange={rate =>
                setSteps(
                  part.steps.map((x, n) => (n === i ? { ...x, rate } : x)),
                )
              }
              label={`The rate of step ${i + 1} of ${part.label}`}
              suffix="%"
              width="w-16"
              disabled={disabled}
            />
            {i > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                disabled={disabled}
                onClick={() => setSteps(part.steps.filter((_, n) => n !== i))}
                aria-label={`Remove step ${i + 1} of ${part.label}`}
              >
                <Trash2 aria-hidden />
              </Button>
            ) : null}
          </span>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={disabled || part.steps.length >= 6}
          onClick={() =>
            setSteps([
              ...part.steps,
              {
                fromMonth: (part.steps.at(-1)?.fromMonth ?? 0) + 1,
                rate: part.steps.at(-1)?.rate ?? 0,
              },
            ])
          }
        >
          <Plus aria-hidden /> Add a month step
        </Button>
      </div>
      <div className="grid gap-1.5 text-xs">
        <CheckRow
          checked={part.ends?.onCancel === true}
          disabled={disabled}
          onChange={v => setEnds(v, lapse)}
        >
          Ends when the client cancels
        </CheckRow>
        <span className="flex flex-wrap items-center gap-2">
          <Checkbox
            checked={lapse !== undefined}
            disabled={disabled}
            onCheckedChange={v =>
              setEnds(part.ends?.onCancel === true, v === true ? 30 : undefined)
            }
            aria-label="Ends after days without a payment"
            className="size-4"
          />
          <span>Ends after</span>
          {lapse !== undefined ? (
            <NumberBox
              value={lapse}
              onChange={v => setEnds(part.ends?.onCancel === true, v)}
              label={`Days without a payment before ${part.label} ends`}
              width="w-16"
              integer
              disabled={disabled}
            />
          ) : (
            <span className="text-muted-foreground">a number of</span>
          )}
          <span>days without a payment</span>
        </span>
        <CheckRow
          checked={part.prorateOnCancel === true}
          disabled={disabled}
          onChange={v => {
            const { prorateOnCancel: _p, ...rest } = part;
            onChange(v ? { ...rest, prorateOnCancel: true } : rest);
          }}
        >
          Pro-rated to a mid-month cancel
        </CheckRow>
      </div>
    </div>
  );
}

function PerAboveFields({
  part,
  onChange,
  disabled,
}: {
  part: PerAbovePart;
  onChange: (next: Part) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
      <NumberBox
        value={part.amount}
        onChange={amount => onChange({ ...part, amount })}
        label={`What ${part.label} pays each`}
        prefix="$"
        width="w-24"
        disabled={disabled}
      />
      <span className="text-muted-foreground">
        for each qualifying client over
      </span>
      <NumberBox
        value={part.over}
        onChange={over => onChange({ ...part, over })}
        label={`The line ${part.label} counts over`}
        width="w-16"
        integer
        disabled={disabled}
      />
    </div>
  );
}

function FloorFields({
  part,
  onChange,
  disabled,
}: {
  part: FloorPart;
  onChange: (next: Part) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
      <span className="text-muted-foreground">At least</span>
      <NumberBox
        value={part.amount}
        onChange={amount => onChange({ ...part, amount })}
        label={`The least ${part.label} guarantees a month`}
        prefix="$"
        width="w-24"
        disabled={disabled}
      />
      <span className="text-muted-foreground">
        a month, base included, for the first
      </span>
      <NumberBox
        value={part.days}
        onChange={days => onChange({ ...part, days })}
        label={`Days ${part.label} lasts`}
        width="w-16"
        integer
        disabled={disabled}
      />
      <span className="text-muted-foreground">
        days from the contract start
      </span>
    </div>
  );
}

/** A role plan's commission lines: what picking the role pre-fills on the roster. */
function CommissionDefaults({
  lines,
  onChange,
  disabled,
}: {
  lines: PlanCommission[];
  onChange: (lines: PlanCommission[]) => void;
  disabled?: boolean;
}) {
  const set = (i: number, next: PlanCommission) =>
    onChange(lines.map((l, n) => (n === i ? next : l)));
  return (
    <section className="grid gap-2">
      <span className={KICKER}>Commission picked with the role</span>
      <p className="text-xs text-muted-foreground">
        Picking this role on the roster fills these lines in. People already on
        it keep their own until you press Apply the role's commission on the
        month.
      </p>
      {lines.map((l, i) => {
        const share = SHARE_BASES.has(l.basis);
        return (
          <span key={i} className="flex flex-wrap items-center gap-2">
            <AnimatedSelect
              value={l.basis}
              disabled={disabled}
              onChange={e => {
                const basis = e.target.value as CommissionBasis;
                // A share and an amount per event are different units: 10% is not $0.10.
                set(i, {
                  basis,
                  rate: SHARE_BASES.has(basis) === share ? l.rate : Number.NaN,
                });
              }}
              aria-label={`Commission line ${i + 1} is paid on`}
              className="ceo-select-sm min-w-0 max-w-full"
            >
              {commissionOptions({})}
            </AnimatedSelect>
            <NumberBox
              value={l.rate}
              scale={share ? 100 : 1}
              onChange={rate => set(i, { ...l, rate })}
              label={`Commission line ${i + 1} rate`}
              prefix={share ? undefined : "$"}
              suffix={share ? "%" : "each"}
              width="w-20"
              disabled={disabled}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              disabled={disabled}
              onClick={() => onChange(lines.filter((_, n) => n !== i))}
              aria-label={`Remove commission line ${i + 1}`}
            >
              <Trash2 aria-hidden />
            </Button>
          </span>
        );
      })}
      {lines.length < 2 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={disabled}
          onClick={() =>
            onChange([
              ...lines,
              // No rate yet: the line asks for one before the plan saves.
              {
                basis: lines.some(l => l.basis === "closed_cash")
                  ? "set_cash"
                  : "closed_cash",
                rate: Number.NaN,
              },
            ])
          }
        >
          <Plus aria-hidden /> Add a commission line
        </Button>
      ) : null}
    </section>
  );
}

/** Every stored version for this role or person: the plan has a history, by month. */
function Versions({ plans, scope }: { plans: PayPlansList; scope: PlanScope }) {
  const rows = plans.plans
    .filter(r =>
      scope.kind === "role"
        ? r.role !== null &&
          scope.role !== null &&
          r.role.trim().toLowerCase() === scope.role.trim().toLowerCase()
        : r.personId === scope.personId,
    )
    .sort((a, b) => b.fromMonth.localeCompare(a.fromMonth));
  if (!rows.length) return null;
  return (
    <section className="grid gap-1.5">
      <span className={KICKER}>Versions</span>
      <ul className="grid gap-1 text-xs text-muted-foreground">
        {rows.map(r => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-2">
            <span className="font-mono tabular-nums text-foreground">
              {monthShortYear(r.fromMonth)}
            </span>
            <span>
              {r.plan === null
                ? "Follows the role plan"
                : `${r.plan.parts.length} ${r.plan.parts.length === 1 ? "part" : "parts"}`}
            </span>
            <span>{`· changed ${shortDate(r.setAt.slice(0, 10))}`}</span>
            {r.note ? <span>{`· ${r.note}`}</span> : null}
            {plans.approvedPlanIds.includes(r.id) ? (
              <StatusChip tone="neutral" label="Used by an approved month" />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
