import { CalendarPlus, Check, Loader2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { pct, shiftMonth, shortDate } from "@/components/ceo/format";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { HoursView } from "@/lib/ceoHoursClient";
import { api, useAction } from "@/lib/cockpitApi";
import { cn } from "@/lib/utils";
import {
  HOURS_DEFAULTS,
  type HoursSettings,
  type PayBasis,
  type PersonMonth,
  type Tracking,
  type Ym,
} from "@/types/ceo/hoursContract";
import {
  BASIS_LABEL,
  EGYPT_NOTE,
  KW_TICK,
  TERMS_TICK,
  TRACKING_LABEL,
} from "./hoursCopy";
import { dayLabel, monthLabel } from "./hoursFormat";

/**
 * People and rules (design 5.5): each person's tracking, pay basis and the
 * month pay starts following hours; the month's rules; and the public
 * holidays with the CEO's own changes. Every default is already set; a
 * change here is one choice, saved on the spot.
 */

const COUNTRIES = [
  "KW",
  "EG",
  "SA",
  "AE",
  "QA",
  "BH",
  "OM",
  "JO",
  "LB",
  "PK",
  "PH",
  "IN",
];

const field = "h-8 rounded-md border bg-background px-2 text-sm";

function errorText(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return raw.split("\n")[0].trim() || fallback;
}

type Say = (ok: boolean, text: string) => void;

/** The one dialog that switches a person's pay to hours (design 5.5). */
function SwitchDialog({
  p,
  month,
  country,
  onClose,
  onDone,
}: {
  p: PersonMonth;
  month: Ym | null;
  country: string | null;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const setTerms = useAction(api.ceo.hours.setTerms);
  const [c, setC] = useState(country ?? "");
  const [tick, setTick] = useState(false);
  const [kw, setKw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const mName = month ? monthLabel(month) : "";
  const ok = Boolean(c) && tick && (c !== "KW" || kw);

  const submit = async () => {
    if (!month) return;
    setBusy(true);
    setMsg(null);
    try {
      await setTerms({
        personId: p.personId,
        hoursPayFrom: month,
        termsConfirmed: true,
        contractCountry: c,
        ...(c === "KW" ? { kwClauseReviewed: true } : {}),
        ...(p.payBasis.value !== "hours" ? { payBasis: "hours" } : {}),
        ...(p.tracking.value !== "required" ? { tracking: "required" } : {}),
      });
      setDone(true);
      await onDone();
    } catch (e) {
      setMsg(errorText(e, "Pay was not switched."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={month !== null} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent className="ceo-root sm:max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle>{`Pay follows hours for ${p.name}`}</DialogTitle>
          <DialogDescription>
            {`${p.role ?? "No role"}. From 1 ${mName}, pay is the share of the month's hours worked, never above base. Until then it stays fixed, with the hours figure shown beside it.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="hours-contract-country">Contract country</Label>
            <AnimatedSelect
              id="hours-contract-country"
              value={c}
              onChange={e => setC(e.target.value)}
              className="ceo-select-sm"
            >
              <option value="">Choose the country</option>
              {COUNTRIES.map(x => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </AnimatedSelect>
          </div>
          <label
            htmlFor="hours-terms-tick"
            className="flex items-start gap-2 text-sm"
          >
            <Checkbox
              id="hours-terms-tick"
              checked={tick}
              onCheckedChange={v => setTick(v === true)}
              className="mt-0.5"
            />
            <span>{TERMS_TICK}</span>
          </label>
          {c === "KW" ? (
            <label
              htmlFor="hours-kw-tick"
              className="flex items-start gap-2 text-sm"
            >
              <Checkbox
                id="hours-kw-tick"
                checked={kw}
                onCheckedChange={v => setKw(v === true)}
                className="mt-0.5"
              />
              <span>
                {KW_TICK}
                <span className="block text-xs text-muted-foreground">
                  Kuwait contracts stay on fixed pay without it.
                </span>
              </span>
            </label>
          ) : null}
          {msg ? (
            <p className="text-sm text-[var(--ceo-critical)]">{msg}</p>
          ) : null}
        </div>
        <DialogFooter>
          {done ? (
            <Button type="button" onClick={onClose}>
              <Check aria-hidden />
              Switched
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" disabled={!ok || busy} onClick={submit}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {`Switch pay to hours from ${mName}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PersonTerms({
  view,
  p,
  focused,
  onChanged,
  say,
}: {
  view: HoursView;
  p: PersonMonth;
  focused: boolean;
  onChanged: () => Promise<void> | void;
  say: Say;
}) {
  const setTerms = useAction(api.ceo.hours.setTerms);
  const inputs = view.inputs.people.find(x => x.personId === p.personId);
  const t = inputs?.terms;
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState<Ym | null>(null);
  const months = useMemo(() => {
    const out: Ym[] = [];
    for (let i = 1; i <= 6; i++) {
      const m = shiftMonth(view.inputs.today.slice(0, 7), i);
      if (m) out.push(m);
    }
    if (t?.hoursPayFrom && !out.includes(t.hoursPayFrom))
      out.unshift(t.hoursPayFrom);
    return out;
  }, [view.inputs.today, t?.hoursPayFrom]);

  const save = async (patch: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await setTerms({ personId: p.personId, ...patch });
      say(true, `${p.name}: ${done}`);
      await onChanged();
    } catch (e) {
      say(false, `${p.name}: ${errorText(e, "not saved.")}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      id={`hours-person-${p.personId}`}
      className={cn(
        "grid gap-2 py-3 @4xl:grid-cols-[minmax(9rem,1.2fr)_9.5rem_10rem_minmax(10rem,1fr)_5.5rem_5.5rem] @4xl:items-center @4xl:gap-x-3",
        focused && "rounded-lg bg-[var(--ceo-emphasis-wash)] px-2",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{p.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {p.role ?? "No role set"}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <AnimatedSelect
          aria-label={`${p.name}: tracking`}
          value={t?.tracking ?? ""}
          disabled={busy}
          onChange={e =>
            void save(
              { tracking: (e.target.value || null) as Tracking | null },
              "tracking saved.",
            )
          }
          className="ceo-select-sm min-w-0 flex-1"
        >
          <option value="">{`${TRACKING_LABEL[p.tracking.value]} · role`}</option>
          {(["required", "optional", "exempt"] as Tracking[]).map(x => (
            <option key={x} value={x}>
              {TRACKING_LABEL[x]}
            </option>
          ))}
        </AnimatedSelect>
      </div>
      <div className="flex items-center gap-1.5">
        <AnimatedSelect
          aria-label={`${p.name}: pay`}
          value={t?.payBasis ?? ""}
          disabled={busy}
          onChange={e => {
            const v = (e.target.value || null) as PayBasis | null;
            void save(
              v === "hours" && p.tracking.value !== "required"
                ? { payBasis: v, tracking: "required" }
                : { payBasis: v },
              v === "hours" && p.tracking.value !== "required"
                ? "pay follows hours, so tracking is now Required."
                : "pay saved.",
            );
          }}
          className="ceo-select-sm min-w-0 flex-1"
        >
          <option value="">{`${BASIS_LABEL[p.payBasis.value]} · role`}</option>
          {(["hours", "fixed"] as PayBasis[]).map(x => (
            <option key={x} value={x}>
              {BASIS_LABEL[x]}
            </option>
          ))}
        </AnimatedSelect>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {p.payBasis.value === "hours" ? (
          <>
            <AnimatedSelect
              aria-label={`${p.name}: pay follows hours from`}
              value={t?.hoursPayFrom ?? ""}
              disabled={busy}
              onChange={e =>
                e.target.value
                  ? setSwitching(e.target.value)
                  : void save(
                      { hoursPayFrom: null },
                      "pay stays fixed for now.",
                    )
              }
              className="ceo-select-sm min-w-0 flex-1"
            >
              <option value="">Not yet (shadow)</option>
              {months.map(m => (
                <option key={m} value={m}>
                  {`${monthLabel(m)} ${m.slice(0, 4)}`}
                </option>
              ))}
            </AnimatedSelect>
            {t?.termsConfirmedAt && t.hoursPayFrom ? (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                <Check className="size-3" aria-hidden />
                signed
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            Fixed pay: hours shown for information
          </span>
        )}
      </div>
      <AnimatedSelect
        aria-label={`${p.name}: contract country`}
        value={t?.contractCountry ?? ""}
        disabled={busy}
        onChange={e =>
          void save(
            { contractCountry: e.target.value || null },
            "contract country saved.",
          )
        }
        className="ceo-select-sm"
      >
        <option value="">—</option>
        {COUNTRIES.map(x => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </AnimatedSelect>
      <AnimatedSelect
        aria-label={`${p.name}: works in`}
        value={t?.worksIn ?? ""}
        disabled={busy}
        onChange={e => void save({ worksIn: e.target.value || null }, "saved.")}
        className="ceo-select-sm"
      >
        <option value="">—</option>
        {COUNTRIES.map(x => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </AnimatedSelect>
      {t?.worksIn === "EG" ? (
        <p className="text-xs text-muted-foreground @4xl:col-span-6">
          {EGYPT_NOTE}
        </p>
      ) : null}
      <SwitchDialog
        p={p}
        month={switching}
        country={t?.contractCountry ?? t?.worksIn ?? null}
        onClose={() => setSwitching(null)}
        onDone={onChanged}
      />
    </div>
  );
}

/** One setting: its words on the left, the control on the right. */
function Setting({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1 py-2 @2xl:grid-cols-[minmax(0,1fr)_auto] @2xl:items-center @2xl:gap-x-4">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

const num = (v: string, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function Rules({
  view,
  onChanged,
}: {
  view: HoursView;
  onChanged: () => Promise<void> | void;
}) {
  const saveRules = useAction(api.ceo.hours.saveRules);
  const [s, setS] = useState<HoursSettings>(view.settings);
  const [from, setFrom] = useState<Ym>(view.inputs.today.slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = (Object.keys(s) as (keyof HoursSettings)[]).filter(
    k => JSON.stringify(s[k]) !== JSON.stringify(view.settings[k]),
  );
  const set = <K extends keyof HoursSettings>(k: K, v: HoursSettings[K]) =>
    setS(x => ({ ...x, [k]: v }));
  const fromOptions = [0, 1, 2]
    .map(i => shiftMonth(view.inputs.today.slice(0, 7), i))
    .filter((m): m is Ym => m !== null);
  const r = view.inputs.rules;

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const settings = Object.fromEntries(changed.map(k => [k, s[k]]));
      await saveRules({ fromMonth: from, settings });
      setMsg({ ok: true, text: `Saved. Applies from ${monthLabel(from)}.` });
      await onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e, "The rules were not saved.") });
    } finally {
      setBusy(false);
    }
  };

  const small = `${field} w-20 text-right font-mono tabular-nums`;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Rules</h3>
        <p className="text-xs text-muted-foreground">
          {r
            ? `In force since ${monthLabel(r.fromMonth)} ${r.fromMonth.slice(0, 4)}, saved ${shortDate(r.savedAt.slice(0, 10))}`
            : "The defaults: nothing has been changed"}
        </p>
      </div>
      <div className="divide-y">
        <Setting
          label="Unpaid break"
          help="Taken off days longer than the threshold, so an 8 h day expects 7 h"
        >
          <input
            aria-label="Break in minutes"
            className={small}
            value={s.breakMinutes}
            onChange={e =>
              set("breakMinutes", num(e.target.value, s.breakMinutes))
            }
          />
          <span className="text-xs text-muted-foreground">
            min on days over
          </span>
          <input
            aria-label="Break when the day is longer than, in hours"
            className={small}
            value={s.breakWhenLongerThanHours}
            onChange={e =>
              set(
                "breakWhenLongerThanHours",
                num(e.target.value, s.breakWhenLongerThanHours),
              )
            }
          />
          <span className="text-xs text-muted-foreground">h</span>
        </Setting>
        <Setting
          label="Grace"
          help={`Up to ${pct(s.graceShare)} short of the month's hours is forgiven; booked unpaid leave never is`}
        >
          <input
            aria-label="Grace, percent of the target"
            className={small}
            value={Math.round(s.graceShare * 1000) / 10}
            onChange={e => set("graceShare", num(e.target.value, 2) / 100)}
          />
          <span className="text-xs text-muted-foreground">%</span>
        </Setting>
        <Setting
          label="Overtime"
          help="Approved in advance, paid only for hours above target"
        >
          <Switch
            checked={s.overtime.on}
            aria-label="Pay overtime"
            onCheckedChange={on => set("overtime", { ...s.overtime, on })}
          />
          <span className="text-xs text-muted-foreground">
            {s.overtime.on ? "On, at" : "Off"}
          </span>
          {s.overtime.on ? (
            <input
              aria-label="Overtime rate"
              className={small}
              value={s.overtime.rate}
              onChange={e =>
                set("overtime", {
                  ...s.overtime,
                  rate: num(e.target.value, s.overtime.rate),
                })
              }
            />
          ) : null}
        </Setting>
        <Setting
          label="Manual time"
          help="Time typed into Hubstaff by hand rather than tracked"
        >
          <AnimatedSelect
            aria-label="Manual time"
            value={s.manualTime}
            onChange={e =>
              set("manualTime", e.target.value as HoursSettings["manualTime"])
            }
            className="ceo-select-sm"
          >
            <option value="review">Needs my OK, once a month</option>
            <option value="counts">Counts</option>
          </AnimatedSelect>
        </Setting>
        <Setting
          label="Idle time"
          help="Time Hubstaff marks idle while the timer runs"
        >
          <Switch
            checked={s.countKeptIdle}
            aria-label="Count idle time"
            onCheckedChange={v => set("countKeptIdle", v)}
          />
          <span className="text-xs text-muted-foreground">
            {s.countKeptIdle ? "Counts, up to" : "Not counted"}
          </span>
          {s.countKeptIdle ? (
            <>
              <input
                aria-label="Idle counted a day, in minutes"
                className={small}
                value={s.keptIdleMaxMinutesPerDay}
                onChange={e =>
                  set(
                    "keptIdleMaxMinutesPerDay",
                    num(e.target.value, s.keptIdleMaxMinutesPerDay),
                  )
                }
              />
              <span className="text-xs text-muted-foreground">min a day</span>
            </>
          ) : null}
        </Setting>
        <Setting label="Daily limit" help="Time above it is shown, not counted">
          <input
            aria-label="Daily limit in hours"
            className={small}
            value={s.dayLimitHours}
            onChange={e =>
              set("dayLimitHours", num(e.target.value, s.dayLimitHours))
            }
          />
          <span className="text-xs text-muted-foreground">h a day</span>
        </Setting>
        <Setting
          label="Work on a day off or a holiday"
          help="Counts toward the month, never above base"
        >
          <AnimatedSelect
            aria-label="Work on a day off"
            value={s.dayOffWork}
            onChange={e =>
              set("dayOffWork", e.target.value as HoursSettings["dayOffWork"])
            }
            className="ceo-select-sm"
          >
            <option value="counts">Counts</option>
            <option value="needs_ok">Needs my OK</option>
          </AnimatedSelect>
        </Setting>
        <Setting
          label="Negative corrections"
          help="The most taken from one month's pay; the rest carries forward"
        >
          <input
            aria-label="Negative correction limit, percent"
            className={small}
            value={Math.round(s.correctionCapShare * 1000) / 10}
            onChange={e =>
              set("correctionCapShare", num(e.target.value, 10) / 100)
            }
          />
          <span className="text-xs text-muted-foreground">
            % of a month's pay
          </span>
        </Setting>
        <Setting
          label="Not tracking"
          help="When to flag someone required who hasn't started the timer"
        >
          <input
            aria-label="Minutes after the start of the day"
            className={small}
            value={s.notTrackingAfterMinutes}
            onChange={e =>
              set(
                "notTrackingAfterMinutes",
                num(e.target.value, s.notTrackingAfterMinutes),
              )
            }
          />
          <span className="text-xs text-muted-foreground">
            min after their start
          </span>
        </Setting>
        <Setting
          label="Low activity note"
          help="A note only; activity never changes pay"
        >
          <Switch
            checked={s.lowActivityShare !== null}
            aria-label="Note low activity"
            onCheckedChange={v => set("lowActivityShare", v ? 0.3 : null)}
          />
          {s.lowActivityShare !== null ? (
            <>
              <span className="text-xs text-muted-foreground">below</span>
              <input
                aria-label="Low activity level, percent"
                className={small}
                value={Math.round(s.lowActivityShare * 100)}
                onChange={e =>
                  set("lowActivityShare", num(e.target.value, 30) / 100)
                }
              />
              <span className="text-xs text-muted-foreground">%</span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Off</span>
          )}
        </Setting>
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-xs text-muted-foreground">Applies from</span>
        <AnimatedSelect
          aria-label="Applies from"
          value={from}
          onChange={e => setFrom(e.target.value)}
          className="ceo-select-sm"
        >
          {fromOptions.map(m => (
            <option key={m} value={m}>
              {`${monthLabel(m)} ${m.slice(0, 4)}`}
            </option>
          ))}
        </AnimatedSelect>
        <Button
          type="button"
          size="sm"
          disabled={busy || !changed.length}
          onClick={submit}
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save rules
        </Button>
        {changed.length ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setS(view.settings)}
          >
            Undo changes
          </Button>
        ) : null}
        {JSON.stringify(s) !== JSON.stringify(HOURS_DEFAULTS) ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setS(HOURS_DEFAULTS)}
          >
            Back to the defaults
          </Button>
        ) : null}
        {msg ? (
          <span
            aria-live="polite"
            className={cn(
              "text-xs",
              msg.ok ? "text-muted-foreground" : "text-[var(--ceo-critical)]",
            )}
          >
            {msg.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Holidays({
  view,
  onChanged,
}: {
  view: HoursView;
  onChanged: () => Promise<void> | void;
}) {
  const holiday = useAction(api.ceo.hours.holiday);
  const list = useMemo(() => {
    const byDay = new Map<
      string,
      { day: string; name: string; source: string }
    >();
    for (const p of view.inputs.people)
      for (const h of p.holidays) if (!byDay.has(h.day)) byDay.set(h.day, h);
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [view.inputs.people]);
  const overrides = view.inputs.holidayOverrides;
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [day, setDay] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"all" | "country" | "person">("all");
  const [scopeValue, setScopeValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: done });
      setAdding(false);
      setMoving(null);
      setDay("");
      setName("");
      await onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e, "The holiday was not saved.") });
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form
      className="grid gap-2 rounded-xl bg-muted/40 p-3 @2xl:grid-cols-[10rem_minmax(0,1fr)_8rem_minmax(0,1fr)_auto] @2xl:items-center"
      onSubmit={e => {
        e.preventDefault();
        const moved = moving ? list.find(h => h.day === moving) : null;
        void run(
          async () => {
            if (moved)
              await holiday({
                day: moved.day,
                action: "remove",
                name: moved.name,
                scope: "all",
                reason: `Moved to ${day}`,
              });
            await holiday({
              day,
              action: "add",
              name: name.trim() || moved?.name || "Holiday",
              scope,
              scopeValue: scope === "all" ? undefined : scopeValue,
              reason: moved ? `Moved from ${moved.day}` : "Added by the CEO",
            });
          },
          moved ? "Moved." : "Added.",
        );
      }}
    >
      <DateInput
        value={day}
        onChange={e => setDay(e.target.value)}
        aria-label="Holiday date"
        className="ceo-select-sm"
      />
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Name, like Prophet's Birthday"
        aria-label="Holiday name"
        className={field}
      />
      <AnimatedSelect
        aria-label="Who has it"
        value={scope}
        onChange={e => setScope(e.target.value as typeof scope)}
        className="ceo-select-sm"
      >
        <option value="all">Everyone</option>
        <option value="country">A country</option>
        <option value="person">One person</option>
      </AnimatedSelect>
      {scope === "all" ? (
        <span />
      ) : scope === "country" ? (
        <AnimatedSelect
          aria-label="Country"
          value={scopeValue}
          onChange={e => setScopeValue(e.target.value)}
          className="ceo-select-sm"
        >
          <option value="">Country</option>
          {COUNTRIES.map(x => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </AnimatedSelect>
      ) : (
        <AnimatedSelect
          aria-label="Person"
          value={scopeValue}
          onChange={e => setScopeValue(e.target.value)}
          className="ceo-select-sm"
        >
          <option value="">Person</option>
          {view.people.map(p => (
            <option key={p.personId} value={String(p.personId)}>
              {p.name}
            </option>
          ))}
        </AnimatedSelect>
      )}
      <Button
        type="submit"
        size="sm"
        disabled={busy || !day || (scope !== "all" && !scopeValue)}
      >
        {moving ? "Move" : "Add"}
      </Button>
    </form>
  );

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{`Public holidays in ${monthLabel(view.month)}`}</h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={adding}
          onClick={() => {
            setMoving(null);
            setAdding(v => !v);
          }}
        >
          <CalendarPlus aria-hidden />
          Add a holiday
        </Button>
      </div>
      {adding ? form : null}
      {list.length ? (
        <ul className="divide-y">
          {list.map(h => (
            <li key={h.day} className="grid gap-2 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="w-24 font-mono text-xs tabular-nums text-muted-foreground">
                  {dayLabel(h.day)}
                </span>
                <span className="min-w-0 flex-1">{h.name}</span>
                <span className="text-xs text-muted-foreground">
                  {h.source === "timetastic" ? "Timetastic" : "Yours"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  disabled={busy}
                  onClick={() => {
                    setAdding(false);
                    setName(h.name);
                    setDay(h.day);
                    setMoving(m => (m === h.day ? null : h.day));
                  }}
                >
                  Move
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        holiday({
                          day: h.day,
                          action: "remove",
                          name: h.name,
                          scope: "all",
                          reason: "Not a holiday this year",
                        }),
                      "Removed.",
                    )
                  }
                >
                  Remove
                </Button>
              </div>
              {moving === h.day ? form : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {`No public holidays in ${monthLabel(view.month)}. Add one if the team had a day off.`}
        </p>
      )}
      {overrides.length ? (
        <div className="grid gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            Your changes
          </p>
          <ul className="grid gap-1 text-xs">
            {overrides.map(o => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-2">
                <span className="font-mono tabular-nums">
                  {dayLabel(o.day)}
                </span>
                <span>
                  {`${o.action === "add" ? "Added" : "Removed"} ${o.name}${o.scope === "all" ? "" : o.scope === "country" ? ` for ${o.scopeValue}` : ` for ${view.people.find(p => String(p.personId) === o.scopeValue)?.name ?? "one person"}`}`}
                </span>
                <span className="text-muted-foreground">{o.reason}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => holiday({ withdrawId: o.id, reason: "Undone" }),
                      "Undone.",
                    )
                  }
                  className="font-medium underline-offset-4 hover:underline"
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {msg ? (
        <p
          aria-live="polite"
          className={cn(
            "text-xs",
            msg.ok ? "text-muted-foreground" : "text-[var(--ceo-critical)]",
          )}
        >
          {msg.text}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        From Timetastic's calendar for each person's country. A holiday on a day
        off isn't moved by itself: add the substitute day here.
      </p>
    </div>
  );
}

export function PeopleRules({
  view,
  focus,
  onChanged,
}: {
  view: HoursView;
  /** A person to highlight, from the sheet's "Settings for" link. */
  focus: number | null;
  onChanged: () => Promise<void> | void;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const people = useMemo(
    () => [...view.people].sort((a, b) => a.name.localeCompare(b.name)),
    [view.people],
  );
  return (
    <div className="grid gap-8">
      <div className="grid gap-1">
        <div className="hidden pb-1 text-xs text-muted-foreground @4xl:grid @4xl:grid-cols-[minmax(9rem,1.2fr)_9.5rem_10rem_minmax(10rem,1fr)_5.5rem_5.5rem] @4xl:gap-x-3">
          <span>Person</span>
          <span>Tracking</span>
          <span>Pay</span>
          <span>Pay follows hours from</span>
          <span>Contract</span>
          <span>Works in</span>
        </div>
        <div className="divide-y">
          {people.map(p => (
            <PersonTerms
              key={p.personId}
              view={view}
              p={p}
              focused={focus === p.personId}
              onChanged={onChanged}
              say={(ok, text) => setMsg({ ok, text })}
            />
          ))}
        </div>
        {msg ? (
          <p
            aria-live="polite"
            className={cn(
              "text-sm",
              msg.ok ? "text-muted-foreground" : "text-[var(--ceo-critical)]",
            )}
          >
            {msg.text}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          Defaults by role: call centre agents and the media buyer are required
          and paid by hours; video editors, closers, setters and client success
          are optional on fixed pay; the rest are exempt. Pay follows hours only
          from the month you switch each person, after their signed contract
          says so; until then the hours figure is a shadow beside fixed pay.
        </p>
      </div>
      <Rules
        key={`${view.month}-${JSON.stringify(view.settings)}`}
        view={view}
        onChanged={onChanged}
      />
      <Holidays view={view} onChanged={onChanged} />
    </div>
  );
}
