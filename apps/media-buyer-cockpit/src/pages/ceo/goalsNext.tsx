import { useAction } from "convex/react";
import { Loader2, Wand2 } from "lucide-react";
import { Fragment, type ReactNode, useMemo, useRef, useState } from "react";
import { count, money, pct } from "@/components/ceo/format";
import { KICKER } from "@/components/ceo/Kicker";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip, StatusDot } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { BOOKING_RATE_GATE, CPB_GATE, CPL_GATE } from "@/lib/kpi";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import { payroll } from "../../../convex/ceo/costsModel";
import type { Board, TargetRow } from "../../../convex/ceo/goals";
import { fmt, paceTone, planTitle, worstThree } from "./goalsKit";
import {
  ALWAYS,
  aTenthBetter,
  DRIVER_KEYS,
  DRIVERS,
  type DriverKey,
  type Drivers,
  type DriverUnit,
  driversFromActuals,
  driversFromTargets,
  MODEL_KEYS,
  modelTargets,
  project,
  REPLACED,
  tidy,
} from "./goalsModel";

/**
 * Next month's plan, worked out in one screen.
 *
 * Aziz, 2026-09-22: "I should be able to set next month's goals in a very
 * easy way in the goals section with that template and set the numbers
 * straight from there for every single thing." And 2026-10-02: "the cost per
 * lead automatically tells me how many leads I get from that ad spend... the
 * projections and goals for the next month... backend, frontend, and average
 * order value... call centers' main metric should be lead to booking."
 *
 * So the funnel is three ladders, drawn the way the Goals board draws its
 * own: what you set sits on the step between two rungs ("at a cost per lead
 * of $10"), and every rung below it is worked out. Change one number and the
 * rungs under it move, with a brief wash so the eye finds them. The rest of
 * the plan (content, creative, systems, the team) is a table as before.
 *
 * Each input shows last month's plan and what really happened beside it, and
 * a tap on either uses it. Nothing is written until Save, and the new plan is
 * a draft until it is made live.
 */

const field =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring";
const label = "text-xs font-medium text-muted-foreground";

function monthEnd(from: string): string {
  const [y, m] = from.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function nextMonthFrom(to: string): string {
  const [y, m] = to.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}
function shortMonth(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleString("en", {
    month: "short",
    timeZone: "UTC",
  });
}

/** A number as it sits in its box: rates in percent, money to the cent under $100. */
function toText(v: number | null, unit: DriverUnit): string {
  if (v === null || !Number.isFinite(v)) return "";
  if (unit === "rate") return String(Math.round(v * 1000) / 10);
  if (unit === "usd")
    return String(
      Math.abs(v) < 100 ? Math.round(v * 100) / 100 : Math.round(v),
    );
  return String(Math.round(v));
}
function fromText(s: string, unit: DriverUnit): number | null {
  const t = s.replace(/[,$%\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return unit === "rate" ? n / 100 : n;
}
function textOf(d: Drivers): Record<DriverKey, string> {
  return Object.fromEntries(
    DRIVER_KEYS.map(k => [k, toText(d[k], DRIVERS[k].unit)]),
  ) as Record<DriverKey, string>;
}
function sayDriver(v: number | null, unit: DriverUnit): string {
  return unit === "rate" ? pct(v) : unit === "usd" ? money(v) : count(v);
}

const NONE = Object.fromEntries(DRIVER_KEYS.map(k => [k, null])) as Drivers;

/** Inputs that are themselves targets: a plan's stretch on one carries over. */
const INPUT_TARGETS: Record<string, DriverKey> = {
  spend: "spend",
  spendRetargeting: "spendRetargeting",
  cpl: "cpl",
  leadToBooked: "leadToBooked",
  introShowRate: "introShowRate",
  demoShowRate: "demoShowRate",
  closeRate: "closeRate",
  aov: "aov",
  mrrProjected: "mrrDue",
  mrrCollectionRate: "mrrCollectionRate",
  upsellCash: "upsellCash",
  labour: "labour",
  overhead: "overhead",
  callLeads: "callLeads",
  callLeadToBooking: "callLeadToBooking",
  clientCpl: "clientCpl",
};

/**
 * A worked-out number. When it changes because an input above it did, it
 * washes teal once; on first draw it does not.
 */
function Worked({
  value,
  unit,
  strong,
}: {
  value: number | null;
  unit: "usd" | "rate" | "count" | "x";
  strong?: boolean;
}) {
  const shown =
    unit === "usd"
      ? money(value)
      : unit === "rate"
        ? pct(value)
        : unit === "x"
          ? fmt(value, "x")
          : count(value);
  // A new value is a new element, so its wash plays once; the value it
  // first drew never washes.
  const first = useRef(shown);
  return (
    <span
      key={shown}
      className={cn(
        "rounded px-1 tabular-nums",
        shown !== first.current && "ceo-flash",
        value === null && "text-muted-foreground",
        strong ? "text-lg font-semibold" : "text-sm font-semibold",
      )}
    >
      {shown}
    </span>
  );
}

export function NextMonth({
  board,
  onClose,
  onSaved,
  onCosts,
}: {
  board: Board;
  onClose: () => void;
  onSaved: (planId: number) => void;
  /** Opens the Costs page, where pay, commission and software are changed. */
  onCosts?: () => void;
}) {
  const savePlan = useAction(api.ceo.goals.savePlan);
  const saveTargets = useAction(api.ceo.goals.saveTargets);

  const plan = board.plan;
  const worst = useMemo(() => worstThree(board.behind), [board]);
  const groups = useMemo(
    () => (Array.isArray(board.groups) ? board.groups : []),
    [board],
  );
  const rows: TargetRow[] = useMemo(
    () => groups.flatMap(g => (Array.isArray(g.targets) ? g.targets : [])),
    [groups],
  );
  const measured = useMemo(() => board.measured ?? {}, [board]);
  const share = board.pace?.share ?? 0;

  // What last month's plan and last month's numbers say each input is.
  const fromPlan = useMemo(
    () =>
      driversFromTargets(
        Object.fromEntries(rows.map(t => [t.metricKey, t.target])),
      ),
    [rows],
  );
  const fromReal = useMemo(
    () => driversFromActuals(measured, share, NONE),
    [measured, share],
  );
  const realOrPlan = useMemo(
    () => driversFromActuals(measured, share, fromPlan),
    [measured, share, fromPlan],
  );
  // Where last month's plan had no number (the call centre's leads, before
  // they were planned), start from what really happened, never from empty.
  const planOrReal = useMemo(
    () =>
      Object.fromEntries(
        DRIVER_KEYS.map(k => [k, fromPlan[k] ?? fromReal[k]]),
      ) as Drivers,
    [fromPlan, fromReal],
  );

  const mon = plan ? shortMonth(plan.periodFrom) : "Last month";
  const whole = (board.pace?.daysLeft ?? 1) === 0;
  const realLabel = whole ? `${mon} actual` : `${mon} so far`;

  const firstDay = plan ? nextMonthFrom(plan.periodTo) : "";
  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(firstDay ? monthEnd(firstDay) : "");
  const [title, setTitle] = useState(firstDay ? planTitle(firstDay) : "");
  const [mission, setMission] = useState(plan?.mission ?? "");
  const [headline, setHeadline] = useState("");
  const [text, setText] = useState<Record<DriverKey, string>>(() =>
    textOf(planOrReal),
  );
  const drivers = useMemo(
    () =>
      Object.fromEntries(
        DRIVER_KEYS.map(k => [k, fromText(text[k] ?? "", DRIVERS[k].unit)]),
      ) as Drivers,
    [text],
  );
  // Payroll, software and other marketing come from the Costs page when it
  // can be read: pay is the roster plus each person's commission priced on
  // this plan's own numbers, so projecting more new cash raises the closer's
  // pay with it (Aziz, 2026-10-02).
  const costs = board.costs ?? null;
  const pay = useMemo(() => {
    if (!costs) return null;
    const first = project(drivers);
    return payroll(
      costs.people,
      {
        newCash: first.newCash,
        contracted: first.contracted,
        introsShown: first.introsShown,
        demosShown: first.demosShown,
        closes: first.closes,
        mrrDue: drivers.mrrDue,
      },
      costs.usdPer,
      { money, count },
    );
  }, [costs, drivers]);
  const used = useMemo(
    () =>
      costs && pay
        ? {
            ...drivers,
            labour: pay.total,
            overhead:
              Math.round((costs.softwareUsd + costs.overheadUsd) * 100) / 100,
            otherMarketing: costs.marketingUsd,
          }
        : drivers,
    [costs, pay, drivers],
  );
  const p = useMemo(() => project(used), [used]);

  // Everything the funnel does not cover stays a row you type.
  const tableGroups = useMemo(
    () =>
      groups
        .map(g => ({
          ...g,
          targets: g.targets.filter(
            t => !MODEL_KEYS.has(t.metricKey) && !REPLACED[t.metricKey],
          ),
        }))
        .filter(g => g.targets.length),
    [groups],
  );
  const tableRows = useMemo(
    () => tableGroups.flatMap(g => g.targets),
    [tableGroups],
  );
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      rows.map(t => [t.id, t.target === null ? "" : String(t.target)]),
    ),
  );
  const [stretch, setStretch] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      rows.map(t => [t.id, t.stretch === null ? "" : String(t.stretch)]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: DriverKey, v: number | null) =>
    setText(cur => ({ ...cur, [k]: toText(v, DRIVERS[k].unit) }));

  const fillTable = (pick: (t: TargetRow) => number | null) =>
    setValues(
      Object.fromEntries(
        tableRows.map(t => {
          const v = pick(t);
          return [t.id, v === null ? "" : String(tidy(v, t.unit))];
        }),
      ),
    );

  // The targets this plan will hold: the model's, each with how it was
  // worked out, then every row typed below.
  const catalogue = useMemo(
    () => new Map(board.catalogue.map((m, i) => [m.key, { ...m, i }])),
    [board],
  );
  const prev = useMemo(() => new Map(rows.map(t => [t.metricKey, t])), [rows]);
  const wanted = useMemo(
    () =>
      [...MODEL_KEYS].filter(
        k =>
          prev.has(k) || ALWAYS.has(k) || Object.values(REPLACED).includes(k),
      ),
    [prev],
  );
  const model = useMemo(
    () =>
      modelTargets(used, p, { money, count, pct })
        .filter(t => wanted.includes(t.key))
        .map(t =>
          costs && pay && t.key === "labour"
            ? {
                ...t,
                how: `From the Costs page: ${money(pay.base)} pay and ${money(pay.commission)} commission on this plan.`,
              }
            : costs && t.key === "overhead"
              ? {
                  ...t,
                  how: `From the Costs page: ${money(costs.softwareUsd)} software and ${money(costs.overheadUsd)} other overhead.`,
                }
              : t,
        ),
    [used, p, wanted, costs, pay],
  );
  const missing = wanted.filter(k => !model.some(t => t.key === k));
  const total = model.length + tableRows.length;

  const changed =
    DRIVER_KEYS.filter(k => text[k] !== toText(planOrReal[k], DRIVERS[k].unit))
      .length +
    tableRows.filter(
      t => (values[t.id] ?? "") !== (t.target === null ? "" : String(t.target)),
    ).length;

  /**
   * An input on the step between two rungs, with last month beside it. A
   * render function rather than a component made inside this one, so the
   * box keeps its focus while you type.
   */
  const input = (k: DriverKey, aria: string) => {
    const unit = DRIVERS[k].unit;
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center rounded-md border border-primary/40 bg-background text-sm focus-within:ring-2 focus-within:ring-ring">
          {unit === "usd" ? (
            <span className="pl-2 text-muted-foreground" aria-hidden>
              $
            </span>
          ) : null}
          <input
            className={cn(
              "bg-transparent px-1.5 py-1 text-right tabular-nums text-foreground outline-none",
              unit === "rate" ? "w-14" : "w-20",
            )}
            inputMode="decimal"
            aria-label={`${aria} for ${title || "next month"}`}
            value={text[k] ?? ""}
            onChange={e => setText(cur => ({ ...cur, [k]: e.target.value }))}
          />
          {unit === "rate" ? (
            <span className="pr-2 text-muted-foreground" aria-hidden>
              %
            </span>
          ) : null}
        </span>
        <span className="inline-flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
          {fromPlan[k] !== null ? (
            <button
              type="button"
              className="underline-offset-2 hover:text-foreground hover:underline"
              title={`Use ${mon}'s plan`}
              onClick={() => set(k, fromPlan[k])}
            >
              {`${mon} plan ${sayDriver(fromPlan[k], unit)}`}
            </button>
          ) : null}
          {fromReal[k] !== null ? (
            <button
              type="button"
              className="underline-offset-2 hover:text-foreground hover:underline"
              title={`Use ${realLabel.toLowerCase()}`}
              onClick={() => set(k, fromReal[k])}
            >
              {`${realLabel} ${sayDriver(fromReal[k], unit)}`}
            </button>
          ) : null}
        </span>
      </span>
    );
  };

  return (
    <SectionCard
      title="Plan the next month"
      description="Set the spend, the costs and the rates. Every count is worked out from them."
      order={1}
      actions={
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-3 @2xl:grid-cols-4">
          <label className="grid gap-1 @2xl:col-span-2">
            <span className={label}>Name</span>
            <input
              className={field}
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </label>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
          <label className="grid gap-1">
            <span className={label}>From</span>
            <DateInput
              className="ceo-select-md w-full"
              value={from}
              onChange={e => {
                setFrom(e.target.value);
                if (e.target.value) {
                  setTo(monthEnd(e.target.value));
                  setTitle(planTitle(e.target.value));
                }
              }}
            />
          </label>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
          <label className="grid gap-1">
            <span className={label}>To</span>
            <DateInput
              className="ceo-select-md w-full"
              value={to}
              onChange={e => setTo(e.target.value)}
            />
          </label>
          <label className="grid gap-1 @2xl:col-span-4">
            <span className={label}>Mission</span>
            <textarea
              className={`${field} min-h-[56px]`}
              value={mission}
              onChange={e => setMission(e.target.value)}
              placeholder="The one sentence next month is for."
            />
          </label>
          <label className="grid gap-1 @2xl:col-span-4">
            <span className={label}>The number to beat</span>
            <textarea
              className={`${field} min-h-[56px]`}
              value={headline}
              onChange={e => setHeadline(e.target.value)}
              placeholder="Collect $X, spend $Y, keep $Z at a W% margin."
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <span className={label}>Start every box from</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setText(textOf(planOrReal));
              fillTable(t => t.target);
            }}
          >
            {`${mon}'s plan`}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setText(textOf(realOrPlan));
              fillTable(t => t.actual ?? t.target);
            }}
          >
            {whole ? `${mon}'s actuals` : `${mon} so far`}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setText(textOf(aTenthBetter(drivers)));
              setValues(cur =>
                Object.fromEntries(
                  tableRows.map(t => {
                    const v = Number(cur[t.id]);
                    if (cur[t.id] === "" || !Number.isFinite(v))
                      return [t.id, cur[t.id] ?? ""];
                    const moved = t.direction === "up" ? v * 1.1 : v * 0.9;
                    return [t.id, String(tidy(moved, t.unit))];
                  }),
                ),
              );
            }}
          >
            <Wand2 aria-hidden />A tenth better
          </Button>
          <span className="text-xs text-muted-foreground">
            {`${changed} changed`}
          </span>
        </div>

        <div className="grid gap-x-10 gap-y-8 @4xl:grid-cols-2">
          <Ladder title="Front end">
            <InputRung label="Ad spend">{input("spend", "Ad spend")}</InputRung>
            <Via text="at a cost per lead of">
              {input("cpl", "Cost per lead")}
            </Via>
            <Rung label="Leads" value={p.leads} unit="count" />
            <Via text="bookable" side>
              {input("qualifiedShare", "Share of leads that are bookable")}
              <Side>
                <Worked value={p.bookableLeads} unit="count" /> bookable at{" "}
                <Worked value={p.costPerBookableLead} unit="usd" /> each
              </Side>
            </Via>
            <Via text="book an intro at">
              {input("leadToBooked", "Lead to booking")}
            </Via>
            <Rung label="Intros booked" value={p.introsBooked} unit="count" />
            <Via text="show at">
              {input("introShowRate", "Intro show rate")}
            </Via>
            <Rung label="Intros held" value={p.introsShown} unit="count" />
            <Via text="book a demo at">
              {input("introToDemo", "Intros held that book a demo")}
            </Via>
            <Rung label="Demos booked" value={p.demosBooked} unit="count" />
            <Via text="show at">{input("demoShowRate", "Demo show rate")}</Via>
            <Rung label="Live demos" value={p.demosShown} unit="count" />
            <Via text="qualified" side>
              {input(
                "qualifiedDemoShare",
                "Share of live demos that are a real fit",
              )}
              <Side>
                <Worked value={p.demosQualified} unit="count" /> qualified demos
              </Side>
            </Via>
            <Via text="close at">{input("closeRate", "Close rate")}</Via>
            <Rung label="Clients signed" value={p.closes} unit="count" />
            <Via text="at an average order of">
              {input("aov", "Average order value")}
            </Via>
            <Rung label="Contracted revenue" value={p.contracted} unit="usd" />
            <Via text="collected in the month">
              {input(
                "cashShare",
                "Share of contracted revenue collected in the month",
              )}
            </Via>
            <Rung label="New-client cash" value={p.newCash} unit="usd" strong />
            <Facts>
              <Fact
                label="Per intro booked"
                value={p.costPerIntroBooked}
                unit="usd"
              />
              <Fact
                label="Per intro held"
                value={p.costPerIntroShown}
                unit="usd"
              />
              <Fact
                label="Per demo booked"
                value={p.costPerDemoBooked}
                unit="usd"
              />
              <Fact
                label="Per live demo"
                value={p.costPerDemoShown}
                unit="usd"
              />
              <Fact label="Per client" value={p.cac} unit="usd" />
              <Fact label="Contracted ROAS" value={p.roasContracted} unit="x" />
            </Facts>
          </Ladder>

          <div className="grid content-start gap-8">
            <Ladder title="Back end and money">
              <InputRung label="MRR due">
                {input("mrrDue", "MRR due")}
              </InputRung>
              <Via text="collected at">
                {input("mrrCollectionRate", "MRR collection rate")}
              </Via>
              <Rung label="Back-end cash" value={p.backEndCash} unit="usd" />
              <InputRung label="Upsell cash">
                {input("upsellCash", "Upsell cash")}
              </InputRung>
              <Rung
                label="Total cash collected"
                value={p.totalCash}
                unit="usd"
                strong
              />
              <li className="grid gap-2 border-t py-3">
                <span className={KICKER}>Money out</span>
                <Line label="Ad spend, from the front end">
                  <Worked value={drivers.spend} unit="usd" />
                </Line>
                <Line label="Retargeting">
                  {input("spendRetargeting", "Retargeting spend")}
                </Line>
                {costs && pay ? (
                  <>
                    <Line label="Payroll, from Costs">
                      <Worked value={pay.total} unit="usd" />
                    </Line>
                    <p className="text-xs text-muted-foreground">
                      {`${money(pay.base)} pay and ${money(pay.commission)} commission on this plan's numbers${pay.noPay.length ? `; no pay set for ${pay.noPay.length}` : ""}${pay.unpriced.length ? `; ${pay.unpriced.length} commission${pay.unpriced.length === 1 ? "" : "s"} not priced` : ""}.`}
                    </p>
                    <Line label="Software and overhead, from Costs">
                      <Worked
                        value={costs.softwareUsd + costs.overheadUsd}
                        unit="usd"
                      />
                    </Line>
                    {costs.marketingUsd > 0 ? (
                      <Line label="Other marketing, from Costs">
                        <Worked value={costs.marketingUsd} unit="usd" />
                      </Line>
                    ) : null}
                    {onCosts ? (
                      <button
                        type="button"
                        className="justify-self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        onClick={onCosts}
                      >
                        Change pay, commission or software on Costs
                      </button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Line label="Payroll">{input("labour", "Payroll")}</Line>
                    <Line label="Software and overhead">
                      {input("overhead", "Software and overhead")}
                    </Line>
                  </>
                )}
                <Line label="Processing fees">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {input("feeRate", "Processing fee rate")}
                    <Worked value={p.processingFees} unit="usd" />
                  </span>
                </Line>
              </li>
              <Rung label="Money out" value={p.moneyOut} unit="usd" />
              <Rung label="Profit" value={p.profit} unit="usd" strong />
              <li className="flex items-center justify-between gap-3 pb-1 text-xs text-muted-foreground">
                <span>Margin</span>
                <Worked value={p.margin} unit="rate" />
              </li>
            </Ladder>

            <Ladder title="Call centre and client results">
              <InputRung label="New client leads">
                {input("callLeads", "New client leads")}
              </InputRung>
              <Via text="booked by the call centre at">
                {input("callLeadToBooking", "Call centre lead to booking")}
                <GateChip
                  good={
                    drivers.callLeadToBooking !== null &&
                    drivers.callLeadToBooking >= BOOKING_RATE_GATE / 100
                  }
                  known={drivers.callLeadToBooking !== null}
                  yes={`At or over ${BOOKING_RATE_GATE}%`}
                  no={`Under ${BOOKING_RATE_GATE}%`}
                />
              </Via>
              <Rung
                label="Client bookings"
                value={p.callBookings}
                unit="count"
              />
              <li className="grid gap-2 border-t py-3">
                <Line label="Client cost per lead">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {input("clientCpl", "Client cost per lead")}
                    <GateChip
                      good={
                        drivers.clientCpl !== null &&
                        drivers.clientCpl <= CPL_GATE
                      }
                      known={drivers.clientCpl !== null}
                      yes={`Inside the ${money(CPL_GATE)} gate`}
                      no={`Over the ${money(CPL_GATE)} gate`}
                    />
                  </span>
                </Line>
                <Line label="Client cost per booking">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <Worked value={p.clientCpb} unit="usd" />
                    <GateChip
                      good={p.clientCpb !== null && p.clientCpb <= CPB_GATE}
                      known={p.clientCpb !== null}
                      yes={`Inside the ${money(CPB_GATE)} gate`}
                      no={`Over the ${money(CPB_GATE)} gate`}
                    />
                  </span>
                </Line>
                <p className="text-xs text-muted-foreground">
                  {bookingSentence(
                    drivers.clientCpl,
                    drivers.callLeadToBooking,
                    p.clientCpb,
                    p.leadToBookingForGate,
                  )}
                </p>
              </li>
            </Ladder>
          </div>
        </div>

        {missing.length ? (
          <p className="rounded-md border border-[var(--ceo-warning)]/40 px-3 py-2 text-sm">
            {`${missing.length} ${missing.length === 1 ? "target has" : "targets have"} no number because an input above is empty: ${missing
              .map(k => catalogue.get(k)?.label ?? k)
              .join(
                ", ",
              )}. Fill the input, or leave it and the plan goes without them.`}
          </p>
        ) : null}

        {tableRows.length ? (
          <div className="grid gap-2 border-t pt-4">
            <span className={KICKER}>The rest of the plan</span>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-2 text-left font-medium">Target</th>
                    <th className="py-2 text-right font-medium">This month</th>
                    <th className="py-2 text-right font-medium">Actual</th>
                    <th className="py-2 text-right font-medium">Next month</th>
                    <th className="py-2 text-right font-medium">Stretch</th>
                  </tr>
                </thead>
                <tbody>
                  {tableGroups.map(g => (
                    <Fragment key={g.key}>
                      <tr className="border-b">
                        <td colSpan={5} className={cn(KICKER, "pb-2 pt-4")}>
                          {g.label}
                        </td>
                      </tr>
                      {g.targets.map(t => (
                        <tr key={t.id} className="border-b last:border-b-0">
                          <td className="py-1.5 pr-3">
                            <span className="font-medium">{t.label}</span>
                            {t.source === "typed" || t.source === "none" ? (
                              <span className="ml-2 text-xs text-muted-foreground">
                                typed in
                              </span>
                            ) : null}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                            {fmt(t.target, t.unit)}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">
                            <span className="inline-flex items-center justify-end gap-1.5">
                              {t.onPace === false ? (
                                <StatusDot
                                  tone={
                                    paceTone(t, worst) === "critical"
                                      ? "critical"
                                      : "warning"
                                  }
                                  label="Behind pace"
                                />
                              ) : null}
                              <span
                                className={
                                  t.actual === null
                                    ? "text-muted-foreground"
                                    : ""
                                }
                              >
                                {fmt(t.actual, t.unit)}
                              </span>
                            </span>
                          </td>
                          <td className="w-28 py-1.5 pl-3">
                            <input
                              className={field}
                              aria-label={`${t.label} target for next month`}
                              inputMode="decimal"
                              value={values[t.id] ?? ""}
                              onChange={e =>
                                setValues(v => ({
                                  ...v,
                                  [t.id]: e.target.value,
                                }))
                              }
                            />
                          </td>
                          <td className="w-24 py-1.5 pl-2">
                            <input
                              className={field}
                              aria-label={`${t.label} stretch for next month`}
                              inputMode="decimal"
                              value={stretch[t.id] ?? ""}
                              onChange={e =>
                                setStretch(v => ({
                                  ...v,
                                  [t.id]: e.target.value,
                                }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={busy || !title.trim() || !from || !to || !total}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const made = await savePlan({
                  periodKind: "month",
                  periodFrom: from,
                  periodTo: to,
                  title,
                  mission,
                  headline,
                  status: "draft",
                });
                const stretchOf = (key: string): number | undefined => {
                  const own = prev.get(key)?.stretch;
                  const was = Object.entries(REPLACED).find(
                    ([, by]) => by === key,
                  )?.[0];
                  const s = own ?? (was ? prev.get(was)?.stretch : null);
                  return s === null || s === undefined ? undefined : s;
                };
                const modelRows = model.flatMap(t => {
                  const def = catalogue.get(t.key);
                  if (!def) return [];
                  const before = prev.get(t.key);
                  return [
                    {
                      groupKey: def.group,
                      metricKey: t.key,
                      label: before?.label ?? def.label,
                      unit: def.unit,
                      direction: def.direction,
                      target: tidy(t.value, def.unit),
                      stretch: INPUT_TARGETS[t.key]
                        ? stretchOf(t.key)
                        : undefined,
                      // This month's real number is next month's baseline,
                      // so the change shows on the row.
                      baseline:
                        measured[t.key] ??
                        before?.actual ??
                        before?.target ??
                        undefined,
                      // A worked-out target says how; an input keeps the
                      // reason written beside it last month.
                      note: t.how ?? before?.note ?? "",
                      sort: def.i,
                    },
                  ];
                });
                const typedRows = tableRows.map(t => ({
                  groupKey: t.groupKey,
                  metricKey: t.metricKey,
                  label: t.label,
                  unit: t.unit,
                  direction: t.direction,
                  target:
                    values[t.id] === "" || values[t.id] === undefined
                      ? undefined
                      : Number(values[t.id]),
                  stretch:
                    stretch[t.id] === "" || stretch[t.id] === undefined
                      ? undefined
                      : Number(stretch[t.id]),
                  baseline: t.actual ?? t.target ?? undefined,
                  note: t.note ?? "",
                  sort: catalogue.get(t.metricKey)?.i ?? 1000 + t.sort,
                }));
                await saveTargets({
                  planId: made.id,
                  targets: [...modelRows, ...typedRows],
                });
                onSaved(made.id);
              } catch (e) {
                setError(
                  String(e instanceof Error ? e.message : e).slice(0, 300),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Saving
              </>
            ) : (
              `Save ${total} targets as a draft`
            )}
          </Button>
          <StatusChip
            tone="neutral"
            label="Draft until you make it live"
            hint="A draft is not scored, so next month can be written days before it starts."
          />
          {error ? (
            <span className="text-sm text-[var(--ceo-critical)]">{error}</span>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}

/** How a client booking's cost follows from the two numbers that make it. */
function bookingSentence(
  cpl: number | null,
  rate: number | null,
  cpb: number | null,
  needed: number | null,
): string {
  if (cpl === null || rate === null || cpb === null)
    return "A client booking costs the cost per lead over the call centre's lead to booking. Fill both to see it.";
  const head = `${money(cpl)} a lead over ${pct(rate)} lead to booking is ${money(cpb)} a booking.`;
  if (cpb <= CPB_GATE) return `${head} Inside the ${money(CPB_GATE)} line.`;
  return `${head} Holding ${money(CPB_GATE)} at ${money(cpl)} a lead needs ${pct(needed)} lead to booking.`;
}

function Ladder({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid content-start gap-1" aria-label={title}>
      <span className={KICKER}>{title}</span>
      <ol className="grid">{children}</ol>
    </section>
  );
}

/** A rung whose number is worked out. */
function Rung({
  label: name,
  value,
  unit,
  strong,
}: {
  label: string;
  value: number | null;
  unit: "usd" | "rate" | "count";
  strong?: boolean;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1.5">
      <span className={cn("text-sm", strong ? "font-semibold" : "font-medium")}>
        {name}
      </span>
      <Worked value={value} unit={unit} strong={strong} />
    </li>
  );
}

/** A rung you set: a budget or an arrival count the chain starts from. */
function InputRung({
  label: name,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
      <span className="text-sm font-medium">{name}</span>
      {children}
    </li>
  );
}

/**
 * The step between two rungs: the rate or cost that turns one into the next.
 * `side` marks a share that is reported beside the chain, not one the next
 * rung is made from.
 */
function Via({
  text,
  side,
  children,
}: {
  text: string;
  side?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      className={cn(
        "ml-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-l-2 py-1 pl-4 text-xs text-muted-foreground",
        side ? "border-dashed border-border" : "border-primary/40",
      )}
    >
      <span>{text}</span>
      {children}
    </li>
  );
}

function Side({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      {children}
    </span>
  );
}

function Line({
  label: name,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
      <span className="text-muted-foreground">{name}</span>
      {children}
    </div>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return <li className="ceo-facts">{children}</li>;
}

function Fact({
  label: name,
  value,
  unit,
}: {
  label: string;
  value: number | null;
  unit: "usd" | "x";
}) {
  return (
    <span className="text-xs text-muted-foreground">
      {name} <Worked value={value} unit={unit} />
    </span>
  );
}

/** Which side of a KPI gate a number sits; nothing when there is no number. */
function GateChip({
  good,
  known,
  yes,
  no,
}: {
  good: boolean;
  known: boolean;
  yes: string;
  no: string;
}) {
  if (!known) return null;
  return (
    <StatusChip tone={good ? "good" : "critical"} label={good ? yes : no} />
  );
}
