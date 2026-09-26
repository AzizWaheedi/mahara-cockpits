import { useAction } from "convex/react";
import {
  Bot,
  Check,
  Clock,
  Pause,
  Play,
  Plus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { Facts } from "@/components/ceo/Facts";
import {
  capitalize,
  count,
  kuwaitDay,
  money,
  plural,
  shortDate,
} from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip } from "@/components/ceo/StatusChip";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Switch } from "@/components/ui/switch";
import { api } from "../../../convex/_generated/api";
import {
  COMMISSION_BASES,
  COMMISSION_SHORT,
  type CommissionBasis,
  SHARE_BASES,
} from "../../../convex/ceo/commission";
import type { Person, Roster } from "../../../convex/ceo/people";
import {
  DAY_LABEL,
  DAY_SHORT,
  type DayHours,
  type DayKey,
  DEFAULT_TIMEZONE,
  defaultSchedule,
  minutesOf,
  normaliseSchedule,
  normaliseTime,
  type Schedule,
  scheduleSummary,
  WEEK_ORDER,
} from "../../../convex/ceo/schedule";

import { usePersonParam } from "./personPage";
import type { CeoTabProps } from "./types";

/**
 * The team and what it costs, on one screen and nothing else.
 *
 * Two lists: on the team, and not any more. Every row is the person, what
 * they do, what they are paid a month and whether they earn commission, with
 * the pay editable in place and one switch to take somebody off the team
 * (they are never deleted: the months they were paid for still happened).
 * Payroll at the top is the sum of the people being paid, in dollars.
 *
 * Three states, kept apart so the total never hides one: being paid, paused
 * (on the team, off this month's payroll, and back with one press), and the
 * shared accounts, which are not colleagues and are never a cost.
 */

const ENGAGEMENTS: { value: Person["engagement"]; label: string }[] = [
  { value: "staff", label: "Staff" },
  { value: "freelancer", label: "Freelancer" },
  { value: "agency", label: "Agency" },
  { value: "intern", label: "Intern" },
  // A shared mailbox or an automation: never headcount, never a cost.
  { value: "bot", label: "Shared account" },
];
const CURRENCIES = ["USD", "KWD", "EGP", "SAR", "AED"];

function serverMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return (
    raw
      .split("\n")[0]
      .replace(/^\[.*?]\s*/, "")
      .trim() || "That did not go through."
  );
}

const field = "rounded-md border bg-background px-2 py-1 text-sm";
/** The same control, quiet enough to sit in the line under a person's name. */
const fieldXs = "rounded border bg-background px-1.5 py-0.5 text-xs";

type Draft = {
  monthlyCost: string;
  currency: string;
  basis: CommissionBasis;
  /** Percent for the share bases (10 = 10%), an amount otherwise. */
  rate: string;
  note: string;
  role: string;
};

const draftOf = (p: Person): Draft => ({
  monthlyCost: p.monthlyCost === null ? "" : String(p.monthlyCost),
  currency: p.currency || "USD",
  basis: p.commission.basis,
  rate:
    p.commission.rate === null
      ? ""
      : String(
          SHARE_BASES.has(p.commission.basis)
            ? Math.round(p.commission.rate * 1000) / 10
            : p.commission.rate,
        ),
  note: p.commissionNote ?? "",
  role: p.role ?? "",
});

const takesRate = (b: CommissionBasis) => b !== "none" && b !== "other";

const tabular = { fontVariantNumeric: "tabular-nums" } as const;

/** What the role select carries for a role that is not on the offered list. */
const OTHER = "__other";

/**
 * What somebody does: the roles Mahara has, and still anything typed.
 *
 * The server offers the roles the company names plus every role already on
 * the roster, and says so is open ended, so "Something else" hands back a
 * plain box. Both controls are native, so a keyboard and a 375px screen get
 * the same thing, and if the list cannot be read the box is all that is left.
 */
function RoleField({
  value,
  roles,
  label,
  disabled,
  className = field,
  onChange,
}: {
  value: string;
  /** The offered roles. Empty falls back to a plain box that takes anything. */
  roles: string[];
  /** What this field is, for a screen reader. */
  label: string;
  disabled?: boolean;
  className?: string;
  onChange: (role: string) => void;
}) {
  // null follows the value: a role on the list selects itself, and the box
  // opens on its own for a role that is not on it.
  const [typed, setTyped] = useState<boolean | null>(null);
  const known = value.trim() !== "" && roles.includes(value);
  const other = typed ?? (value.trim() !== "" && !known);
  const box = `${className} min-w-0 max-w-full`;

  if (!roles.length)
    return (
      <input
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        placeholder="What they do"
        aria-label={label}
        className={box}
      />
    );

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <AnimatedSelect
        value={other ? OTHER : known ? value : ""}
        disabled={disabled}
        onChange={e => {
          if (e.target.value === OTHER) {
            setTyped(true);
            onChange("");
            return;
          }
          setTyped(false);
          onChange(e.target.value);
        }}
        aria-label={label}
        className={box}
      >
        <option value="">What they do</option>
        {roles.map(r => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
        <option value={OTHER}>Something else</option>
      </AnimatedSelect>
      {other ? (
        <input
          value={value}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          placeholder="Type the role"
          aria-label={`${label}, typed`}
          className={box}
        />
      ) : null}
    </span>
  );
}

function Toggle({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <Switch
      checked={on}
      aria-label={label}
      disabled={disabled}
      onCheckedChange={onChange}
      // The switch is 24px tall; the invisible ring makes it an easy tap.
      className="relative after:absolute after:-inset-2 after:content-['']"
    />
  );
}

/** A 24 hour track with the working window drawn on it: the shape of a day at a glance. */
function DayBar({ start, end }: { start: string; end: string }) {
  const s = normaliseTime(start);
  const e = normaliseTime(end);
  const ok = s !== null && e !== null && minutesOf(e) > minutesOf(s);
  return (
    <span
      className="relative hidden h-1 min-w-12 flex-1 rounded-full bg-[var(--ceo-emphasis-track)] @md:block"
      aria-hidden
    >
      {ok ? (
        <span
          className="absolute inset-y-0 rounded-full bg-[var(--ceo-emphasis)]"
          style={{
            left: `${(minutesOf(s) / 1440) * 100}%`,
            width: `${((minutesOf(e) - minutesOf(s)) / 1440) * 100}%`,
          }}
        />
      ) : null}
    </span>
  );
}

type ExceptionDraft = {
  key: number;
  date: string;
  off: boolean;
  start: string;
  end: string;
};
type HoursDraft = {
  week: Record<DayKey, DayHours>;
  exceptions: ExceptionDraft[];
};

let exceptionKey = 0;

const hoursDraftOf = (s: Schedule | null): HoursDraft => {
  const base = s ?? defaultSchedule();
  return {
    week: { ...base.week },
    exceptions: base.exceptions.map(x => ({
      key: ++exceptionKey,
      date: x.date,
      off: "off" in x,
      start: "off" in x ? "10:00" : x.start,
      end: "off" in x ? "14:00" : x.end,
    })),
  };
};

/** The draft in the stored shape, for normaliseSchedule to check. */
const scheduleOf = (h: HoursDraft, timezone: string): unknown => ({
  timezone,
  week: h.week,
  exceptions: h.exceptions.map(x =>
    x.off
      ? { date: x.date, off: true }
      : { date: x.date, start: x.start, end: x.end },
  ),
});

/**
 * The hours editor under a row: the week, Saturday first, then the dates that
 * break it. Every keystroke is checked by the same rule the server applies,
 * so the sentence at the bottom is either the summary that will be stored or
 * what still needs fixing.
 */
function HoursEditor({
  person,
  busy,
  onSave,
  onClose,
}: {
  person: Person;
  busy: boolean;
  /** Saves the row with these hours; null clears them. Throws the server's sentence. */
  onSave: (schedule: Schedule | null) => Promise<void>;
  onClose: () => void;
}) {
  const [h, setH] = useState<HoursDraft>(() => hoursDraftOf(person.schedule));
  const [msg, setMsg] = useState<string | null>(null);
  const timezone = person.schedule?.timezone ?? DEFAULT_TIMEZONE;
  const checked = useMemo<{
    schedule: Schedule | null;
    problem: string | null;
  }>(() => {
    try {
      return {
        schedule: normaliseSchedule(scheduleOf(h, timezone)),
        problem: null,
      };
    } catch (e) {
      return {
        schedule: null,
        problem: e instanceof Error ? e.message : String(e),
      };
    }
  }, [h, timezone]);

  const setDay = (k: DayKey, patch: Partial<DayHours>) =>
    setH(v => ({ ...v, week: { ...v.week, [k]: { ...v.week[k], ...patch } } }));
  const setException = (key: number, patch: Partial<ExceptionDraft>) =>
    setH(v => ({
      ...v,
      exceptions: v.exceptions.map(x =>
        x.key === key ? { ...x, ...patch } : x,
      ),
    }));
  const addException = () =>
    setH(v => ({
      ...v,
      exceptions: [
        ...v.exceptions,
        {
          key: ++exceptionKey,
          date: "",
          off: true,
          start: "10:00",
          end: "14:00",
        },
      ],
    }));
  const removeException = (key: number) =>
    setH(v => ({ ...v, exceptions: v.exceptions.filter(x => x.key !== key) }));

  const submit = async (schedule: Schedule | null) => {
    setMsg(null);
    try {
      await onSave(schedule);
    } catch (e) {
      setMsg(serverMessage(e));
    }
  };

  return (
    <div className="grid gap-4 rounded-xl bg-muted/40 p-4 @3xl:grid-cols-2 @3xl:gap-x-6 @5xl:col-span-4">
      {/* Its own container: on a phone the times take the line under the day. */}
      <div className="@container/week grid gap-1.5">
        <span className="text-xs text-muted-foreground">{`A normal week, ${timezone} time`}</span>
        {WEEK_ORDER.map(k => {
          const d = h.week[k];
          return (
            <div
              key={k}
              className="grid grid-cols-[2.5rem_2.75rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 text-sm"
            >
              <span className={d.on ? "" : "text-muted-foreground"}>
                {DAY_SHORT[k]}
              </span>
              <Toggle
                on={d.on}
                label={`${DAY_LABEL[k]}, ${d.on ? "working" : "off"}`}
                disabled={busy}
                onChange={on => setDay(k, { on })}
              />
              {d.on ? (
                <span className="col-span-3 flex min-w-0 items-center gap-1.5 @sm/week:col-span-1">
                  <input
                    type="time"
                    value={d.start}
                    onChange={e => setDay(k, { start: e.target.value })}
                    aria-label={`${DAY_LABEL[k]} start`}
                    className={`${field} w-32 min-w-0`}
                    style={tabular}
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <input
                    type="time"
                    value={d.end}
                    onChange={e => setDay(k, { end: e.target.value })}
                    aria-label={`${DAY_LABEL[k]} end`}
                    className={`${field} w-32 min-w-0`}
                    style={tabular}
                  />
                  <DayBar start={d.start} end={d.end} />
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Off</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid content-start gap-1.5">
        <span className="text-xs text-muted-foreground">
          Exceptions: a date off, or different hours that day
        </span>
        {h.exceptions.length ? (
          h.exceptions.map(x => (
            <div
              key={x.key}
              className="flex flex-wrap items-center gap-1.5 text-sm"
            >
              <DateInput
                value={x.date}
                onChange={e => setException(x.key, { date: e.target.value })}
                aria-label="Exception date"
                className={`${field} w-[9.5rem]`}
                style={tabular}
              />
              <AnimatedSelect
                value={x.off ? "off" : "hours"}
                onChange={e =>
                  setException(x.key, { off: e.target.value === "off" })
                }
                aria-label="Off that day, or different hours"
                className={field}
              >
                <option value="off">Off</option>
                <option value="hours">Different hours</option>
              </AnimatedSelect>
              {x.off ? null : (
                <>
                  <input
                    type="time"
                    value={x.start}
                    onChange={e =>
                      setException(x.key, { start: e.target.value })
                    }
                    aria-label="Exception start"
                    className={`${field} w-32`}
                    style={tabular}
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <input
                    type="time"
                    value={x.end}
                    onChange={e => setException(x.key, { end: e.target.value })}
                    aria-label="Exception end"
                    className={`${field} w-32`}
                    style={tabular}
                  />
                </>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => removeException(x.key)}
                aria-label="Remove this exception"
                className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">
            None yet. Add one for a day off or shorter hours.
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={addException}
          className="w-fit"
        >
          <Plus aria-hidden /> Add an exception
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 @3xl:col-span-2">
        <p
          className={`min-w-0 basis-full text-xs ${checked.problem ? "text-[var(--ceo-critical)]" : "text-muted-foreground"}`}
        >
          {checked.schedule
            ? scheduleSummary(checked.schedule)
            : checked.problem}
        </p>
        <Button
          type="button"
          size="sm"
          disabled={busy || !checked.schedule}
          onClick={() => checked.schedule && submit(checked.schedule)}
        >
          <Check aria-hidden /> Save hours
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </Button>
        {person.schedule ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => submit(null)}
            className="text-muted-foreground"
          >
            Clear hours
          </Button>
        ) : null}
      </div>
      {msg ? (
        <p className="text-xs text-[var(--ceo-critical)] @3xl:col-span-2">
          {msg}
        </p>
      ) : null}
    </div>
  );
}

function Row({
  p,
  roles,
  onChanged,
  onOpen,
}: {
  p: Person;
  roles: string[];
  onChanged: () => Promise<void>;
  /** Open this person's file: goals, flags, CV and the monthly scorecard. */
  onOpen: (p: Person) => void;
}) {
  const save = useAction(api.ceo.people.save);
  const setActive = useAction(api.ceo.people.setActive);
  const [d, setD] = useState<Draft>(() => draftOf(p));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [why, setWhy] = useState("");
  const base = draftOf(p);
  const dirty =
    d.monthlyCost !== base.monthlyCost ||
    d.currency !== base.currency ||
    d.basis !== base.basis ||
    d.rate !== base.rate ||
    d.note !== base.note ||
    d.role !== base.role;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setMsg(serverMessage(e));
    } finally {
      setBusy(false);
    }
  };

  /** Everything save() overwrites, from the draft, so hours never wipe the pay typed beside them. */
  const argsOf = (draft: Draft) => ({
    id: p.id,
    name: p.name,
    email: p.email ?? undefined,
    role: draft.role.trim() || undefined,
    engagement: p.engagement,
    monthlyCost:
      draft.monthlyCost.trim() === "" ? undefined : Number(draft.monthlyCost),
    currency: draft.currency,
    commissionBasis: draft.basis,
    commissionRate:
      !takesRate(draft.basis) || draft.rate.trim() === ""
        ? undefined
        : SHARE_BASES.has(draft.basis)
          ? Number(draft.rate) / 100
          : Number(draft.rate),
    commissionNote: draft.note.trim() || undefined,
    isSales: p.isSales,
    startedOn: p.startedOn ?? undefined,
  });

  /** The hours editor's save: the row as drafted plus the hours. Throws so the editor can show why. */
  const saveHours = async (schedule: Schedule | null) => {
    setBusy(true);
    try {
      await save({ ...argsOf(d), schedule });
      await onChanged();
      setHoursOpen(false);
    } finally {
      setBusy(false);
    }
  };

  /** Pausing and unpausing are the same save the row already does. */
  const pause = () =>
    act(async () => {
      await save({
        ...argsOf(d),
        pausedOn: kuwaitDay(),
        pausedWhy: why.trim(),
      });
      setPausing(false);
      setWhy("");
    });
  const unpause = () =>
    act(() => save({ ...argsOf(d), pausedOn: null, pausedWhy: null }));

  const initial = (p.name || p.email || "?").trim().charAt(0).toUpperCase();
  // A shared account is not a colleague: no pay, no commission, no hours.
  const account = p.engagement === "bot";
  const paused = !account && Boolean(p.pausedOn);
  const onWord = account ? "in use" : "on the team";
  const offWord = account ? "retired" : "off the team";

  return (
    <div className="grid gap-2 py-3 @5xl:grid-cols-[minmax(0,1.4fr)_15rem_13rem_auto] @5xl:items-center">
      <div className="flex min-w-0 items-center gap-3">
        {account ? (
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
            aria-hidden
          >
            <Bot className="size-4" aria-hidden />
          </span>
        ) : (
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${p.active ? "bg-[var(--ceo-emphasis-wash)] text-[var(--ceo-emphasis)]" : "bg-muted text-muted-foreground"}`}
            aria-hidden
          >
            {initial}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {account ? (
              <span className="truncate font-medium">{p.name}</span>
            ) : (
              <button
                type="button"
                onClick={() => onOpen(p)}
                className="truncate text-left font-medium underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
                title={`Open ${p.name}'s file`}
              >
                {p.name}
              </button>
            )}
            {paused ? <StatusChip tone="neutral" label="Paused" /> : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <RoleField
              value={d.role}
              roles={roles}
              label={`${p.name}'s role`}
              disabled={busy}
              className={`${fieldXs} w-40`}
              onChange={role => setD({ ...d, role })}
            />
            <span>
              {ENGAGEMENTS.find(e => e.value === p.engagement)?.label ??
                p.engagement}
            </span>
            {p.email ? <span className="truncate">{p.email}</span> : null}
          </div>
          {paused ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {`Still on the team, paused since ${shortDate(p.pausedOn)}${p.pausedWhy ? `: ${p.pausedWhy}` : ", no reason recorded"}`}
            </p>
          ) : null}
          {account ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              An account Mahara runs, not a colleague.
            </p>
          ) : (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <Clock className="size-3 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">
                {p.schedule ? scheduleSummary(p.schedule) : "No hours set"}
              </span>
              <button
                type="button"
                onClick={() => setHoursOpen(v => !v)}
                aria-expanded={hoursOpen}
                className="font-medium text-foreground/80 underline-offset-2 hover:underline"
              >
                {hoursOpen ? "Close" : "Edit hours"}
              </button>
            </div>
          )}
        </div>
      </div>
      {account ? (
        <p className="text-xs text-muted-foreground @5xl:col-span-2">
          No pay and no commission
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 @5xl:contents">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <input
              inputMode="decimal"
              value={d.monthlyCost}
              onChange={e => setD({ ...d, monthlyCost: e.target.value })}
              placeholder="Pay a month"
              aria-label={`${p.name}'s monthly pay`}
              className={`${field} w-28 text-right`}
              style={{ fontVariantNumeric: "tabular-nums" }}
            />
            <AnimatedSelect
              value={d.currency}
              onChange={e => setD({ ...d, currency: e.target.value })}
              aria-label="Currency"
              className={`${field} w-20`}
            >
              {CURRENCIES.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </AnimatedSelect>
            {p.monthlyUsd !== null && d.currency !== "USD" ? (
              <span className="text-xs text-muted-foreground">{`≈ ${money(p.monthlyUsd)}`}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <AnimatedSelect
              value={d.basis}
              onChange={e =>
                setD({ ...d, basis: e.target.value as CommissionBasis })
              }
              aria-label={`What ${p.name}'s commission is paid on`}
              className={`${field} max-w-[12rem]`}
            >
              {COMMISSION_BASES.map(b => (
                <option key={b} value={b}>
                  {COMMISSION_SHORT[b]}
                </option>
              ))}
            </AnimatedSelect>
            {takesRate(d.basis) ? (
              <span className="flex items-center gap-1">
                <input
                  inputMode="decimal"
                  value={d.rate}
                  onChange={e => setD({ ...d, rate: e.target.value })}
                  placeholder={SHARE_BASES.has(d.basis) ? "10" : "50"}
                  aria-label={`${p.name}'s commission rate`}
                  className={`${field} w-16 text-right`}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                />
                <span className="text-xs text-muted-foreground">
                  {SHARE_BASES.has(d.basis) ? "%" : d.currency}
                </span>
              </span>
            ) : null}
            {d.basis === "other" || d.note ? (
              <input
                value={d.note}
                onChange={e => setD({ ...d, note: e.target.value })}
                placeholder="How it works"
                aria-label={`${p.name}'s commission note`}
                className={`${field} w-36`}
              />
            ) : null}
            {p.isSales ? <StatusChip tone="neutral" label="Sales" /> : null}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty ? (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => act(() => save(argsOf(d)))}
          >
            <Check aria-hidden /> Save
          </Button>
        ) : null}
        {account || !p.active ? null : paused ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={unpause}
          >
            <Play aria-hidden /> Unpause
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            aria-expanded={pausing}
            onClick={() => {
              setWhy("");
              setPausing(v => !v);
            }}
            className="text-muted-foreground"
          >
            <Pause aria-hidden /> Pause
          </Button>
        )}
        <label
          htmlFor={`team-active-${p.id}`}
          className="flex cursor-pointer items-center gap-2 text-xs"
        >
          <span className="text-muted-foreground">
            {capitalize(p.active ? onWord : offWord)}
          </span>
          <Switch
            id={`team-active-${p.id}`}
            checked={p.active}
            aria-label={`${p.name} is ${p.active ? onWord : offWord}`}
            disabled={busy}
            onCheckedChange={() =>
              act(() =>
                setActive({
                  id: p.id,
                  active: !p.active,
                  endedOn: p.active
                    ? new Date().toISOString().slice(0, 10)
                    : undefined,
                }),
              )
            }
            className="relative after:absolute after:-inset-2 after:content-['']"
          />
        </label>
      </div>
      {pausing ? (
        <div className="flex flex-wrap items-center gap-2 text-xs @5xl:col-span-4">
          <span className="text-muted-foreground">Paused because</span>
          <input
            value={why}
            onChange={e => setWhy(e.target.value)}
            placeholder="Between projects"
            aria-label={`Why ${p.name} is paused`}
            className={`${field} w-56 max-w-full`}
          />
          <Button
            type="button"
            size="sm"
            disabled={busy || !why.trim()}
            onClick={pause}
          >
            <Pause aria-hidden /> Pause
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setPausing(false)}
          >
            Cancel
          </Button>
          <span className="text-muted-foreground">
            They stay on the team, off this month's payroll.
          </span>
        </div>
      ) : null}
      {msg ? (
        <p className="text-xs text-[var(--ceo-critical)] @5xl:col-span-4">
          {msg}
        </p>
      ) : null}
      {hoursOpen ? (
        <HoursEditor
          person={p}
          busy={busy}
          onSave={saveHours}
          onClose={() => setHoursOpen(false)}
        />
      ) : null}
    </div>
  );
}

function AddPerson({
  roles,
  onAdded,
}: {
  roles: string[];
  onAdded: () => Promise<void>;
}) {
  const save = useAction(api.ceo.people.save);
  const importWorkspace = useAction(api.ceo.people.importWorkspace);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [engagement, setEngagement] = useState<Person["engagement"]>("staff");
  const [pay, setPay] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
      await onAdded();
    } catch (e) {
      setMsg(serverMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
        >
          <UserPlus aria-hidden /> Add someone
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() =>
            act(async () => {
              const out = (await importWorkspace({})) as {
                added: string[];
                alreadyThere: number;
                problem?: string;
              };
              setMsg(
                `Workspace read: ${out.added.length} added, ${out.alreadyThere} already here${out.problem ? ` · ${out.problem}` : ""}.`,
              );
            }, "")
          }
        >
          Add from Google Workspace
        </Button>
        {msg ? (
          <span className="text-sm text-muted-foreground">{msg}</span>
        ) : null}
      </div>
      {open ? (
        <div className="grid gap-2 rounded-xl bg-muted/40 p-4 @md:grid-cols-2 @3xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_8rem_7rem_5.5rem_auto]">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Name"
            aria-label="Name"
            className={field}
          />
          <RoleField
            value={role}
            roles={roles}
            label="Role"
            disabled={busy}
            onChange={setRole}
          />
          <AnimatedSelect
            value={engagement}
            onChange={e =>
              setEngagement(e.target.value as Person["engagement"])
            }
            aria-label="Engagement"
            className={field}
          >
            {ENGAGEMENTS.map(e => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </AnimatedSelect>
          {engagement === "bot" ? (
            <p className="self-center text-xs text-muted-foreground @3xl:col-span-2">
              An account, never paid
            </p>
          ) : (
            <>
              <input
                inputMode="decimal"
                value={pay}
                onChange={e => setPay(e.target.value)}
                placeholder="Pay a month"
                aria-label="Monthly pay"
                className={field}
              />
              <AnimatedSelect
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                aria-label="Currency"
                className={field}
              >
                {CURRENCIES.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </AnimatedSelect>
            </>
          )}
          <Button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() =>
              act(async () => {
                await save({
                  name: name.trim(),
                  role: role.trim() || undefined,
                  engagement,
                  monthlyCost:
                    engagement === "bot" || pay.trim() === ""
                      ? undefined
                      : Number(pay),
                  currency,
                });
                setName("");
                setRole("");
                setPay("");
                setOpen(false);
              }, "Added.")
            }
          >
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function TeamTab({ goTab }: CeoTabProps) {
  const load = useAction(api.ceo.people.list);
  const loadRoles = useAction(api.ceo.people.roles);
  const [data, setData] = useState<Roster | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showGone, setShowGone] = useState(false);
  // Opening somebody goes to their page under Management, which is where
  // their file lives; this list is about what they cost.
  const [, setPerson] = usePersonParam();

  const refresh = useCallback(async () => {
    try {
      setData((await load({})) as Roster);
      setError(null);
    } catch (e) {
      setError(serverMessage(e));
    }
    try {
      setRoles((await loadRoles({})) as string[]);
    } catch {
      // The roles are only a suggestion: without them the box still takes
      // anything typed, so a roster edit never waits on this call.
      setRoles([]);
    }
  }, [load, loadRoles]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The accounts sit at the foot of the list, so "on the team" reads as people.
  const live = useMemo(
    () =>
      (data?.people ?? [])
        .filter(p => p.active)
        .sort(
          (a, b) =>
            Number(a.engagement === "bot") - Number(b.engagement === "bot"),
        ),
    [data],
  );
  const gone = useMemo(
    () => (data?.people ?? []).filter(p => !p.active),
    [data],
  );
  const working = live.filter(p => p.working);
  const uncosted = data?.missingCost.length ?? 0;
  const external = working.filter(p => p.engagement !== "staff").length;
  const onCommission = working.filter(
    p => p.commission.basis !== "none",
  ).length;
  // Until the roster loads the tiles say n/a, with the reason, never a dash.
  const notLoaded = error
    ? "The roster could not be read. The reason is under the buttons."
    : "The roster has not loaded yet.";

  return (
    <div className="@container grid gap-4 lg:gap-6">
      {/* The page is Team & payroll already; this card is the roster summary. */}
      <SectionCard
        title="Roster"
        description="Who Mahara pays, and what it costs a month."
        order={0}
      >
        {() => (
          <div className="grid gap-6">
            <div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-6 @xl:grid-cols-3 @4xl:grid-cols-5">
                <StatTile
                  variant="plain"
                  label="On payroll"
                  value={data ? count(data.activeCount) : null}
                  naHint={notLoaded}
                  sub={
                    data ? `${count(external)} freelance or agency` : undefined
                  }
                  hint="Everyone on the team being paid this month. Paused people and shared accounts are counted beside it, not inside it."
                />
                <StatTile
                  variant="plain"
                  label="Payroll a month"
                  value={data ? money(data.activeMonthlyUsd) : null}
                  naHint={notLoaded}
                  sub={
                    !data
                      ? undefined
                      : uncosted
                        ? `${plural(uncosted, "person", "people")} not costed yet`
                        : "Everyone costed"
                  }
                  hint="The sum of monthly pay for everyone being paid, converted to dollars at the cockpit's fixed rates. Paused people and shared accounts are out of it, and people without a pay figure are missing from it, not zero."
                />
                <StatTile
                  variant="plain"
                  label="Paused"
                  value={data ? count(data.pausedCount) : null}
                  naHint={notLoaded}
                  sub={
                    !data
                      ? undefined
                      : data.pausedCount
                        ? `${money(data.pausedMonthlyUsd)} held back this month`
                        : "Everyone on the team is being paid"
                  }
                  hint="On the team and off this month's payroll. Their pay is kept out of the payroll figure, and comes back the day they do."
                />
                <StatTile
                  variant="plain"
                  label="On commission"
                  value={data ? count(onCommission) : null}
                  naHint={notLoaded}
                />
                <StatTile
                  variant="plain"
                  label="Off the team"
                  value={data ? count(gone.length) : null}
                  naHint={notLoaded}
                  sub={data ? "Kept for the months they were paid" : undefined}
                />
              </div>
              <Facts
                items={[
                  {
                    label: "Shared accounts",
                    value: data ? count(data.botCount) : null,
                    hint: "Mailboxes and automations on the roster. Never headcount, never a cost.",
                  },
                ]}
              />
            </div>
            <AddPerson roles={roles} onAdded={refresh} />
            {error ? (
              <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
            ) : null}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="On the team"
        description="Pay, commission and hours edit in place. Pause somebody without taking them off."
        order={1}
      >
        {() =>
          data === null ? null : (
            <>
              {live.length ? (
                <div className="divide-y">
                  <div className="hidden pb-2 text-xs text-muted-foreground @5xl:grid @5xl:grid-cols-[minmax(0,1.4fr)_15rem_13rem_auto]">
                    <span>Person</span>
                    <span>Pay a month</span>
                    <span>Commission</span>
                    <span />
                  </div>
                  {live.map(p => (
                    <Row
                      key={p.id}
                      p={p}
                      roles={roles}
                      onChanged={refresh}
                      onOpen={p => {
                        setPerson(p.id);
                        goTab("management");
                      }}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Nobody on the team yet"
                  text="Add someone above, or pull the Google Workspace directory in."
                  icon={Users}
                  compact
                />
              )}
              {data.people.some(p => p.commission.basis !== "none") ? (
                <details className="mt-4 border-t pt-3">
                  <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
                    How commission works
                  </summary>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Commission is a rule per person: what it is paid on, then
                    the rate in that unit. A share is typed as a percent; a
                    per-unit amount is in the person's currency. The payout
                    itself is not worked out here yet.
                  </p>
                </details>
              ) : null}
            </>
          )
        }
      </SectionCard>

      {gone.length ? (
        <SectionCard
          title="Off the team"
          kicker={`${plural(gone.length, "person", "people")}`}
          order={2}
          actions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={showGone}
              onClick={() => setShowGone(v => !v)}
            >
              {showGone ? "Hide" : "Show"}
            </Button>
          }
        >
          {() =>
            showGone ? (
              <div className="divide-y">
                {gone.map(p => (
                  <Row
                    key={p.id}
                    p={p}
                    roles={roles}
                    onChanged={refresh}
                    onOpen={p => {
                      setPerson(p.id);
                      goTab("management");
                    }}
                  />
                ))}
              </div>
            ) : null
          }
        </SectionCard>
      ) : null}
    </div>
  );
}
