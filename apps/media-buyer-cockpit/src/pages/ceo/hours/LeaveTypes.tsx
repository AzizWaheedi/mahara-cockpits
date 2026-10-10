import { Loader2 } from "lucide-react";
import { useState } from "react";
import { plural, shiftMonth } from "@/components/ceo/format";
import { StatusChip } from "@/components/ceo/StatusChip";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import type { HoursView } from "@/lib/ceoHoursClient";
import { api, useAction } from "@/lib/cockpitApi";
import { cn } from "@/lib/utils";
import type { LeaveTypeRule, Ym } from "@/types/ceo/hoursContract";
import { monthLabel } from "./hoursFormat";

/**
 * Leave types (design 5.7): one row per Timetastic type and what it pays. A
 * type with no rule shows the suggestion already chosen, so one click saves
 * it; a suggestion is never saved without that click. Changing a rule later
 * asks from which month.
 */

type Rule = NonNullable<LeaveTypeRule["payRule"]>;

const RULE_LABEL: Record<Rule, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  part: "Part paid",
  not_leave: "Not time off (hours come from Hubstaff)",
};

function errorText(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return raw.split("\n")[0].trim() || fallback;
}

function TypeRow({
  t,
  today,
  onChanged,
}: {
  t: LeaveTypeRule;
  today: string;
  onChanged: () => Promise<void> | void;
}) {
  const save = useAction(api.ceo.hours.setLeaveType);
  const current: Rule | null = t.payRule;
  const [rule, setRule] = useState<Rule>(current ?? t.suggested ?? "paid");
  const [share, setShare] = useState(
    String(Math.round((t.paidShare ?? 0.5) * 100)),
  );
  const thisMonth = today.slice(0, 7);
  const [from, setFrom] = useState<Ym>(thisMonth);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const shareNum = Number(share) / 100;
  const changed =
    current === null ||
    rule !== current ||
    (rule === "part" && Math.abs(shareNum - (t.paidShare ?? 0)) > 0.0005);
  const validShare = rule !== "part" || (shareNum > 0 && shareNum < 1);
  const months = [-2, -1, 0, 1]
    .map(i => shiftMonth(thisMonth, i))
    .filter((m): m is Ym => m !== null);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await save({
        externalId: t.externalId,
        payRule: rule,
        ...(rule === "part" ? { paidShare: shareNum } : {}),
        ...(current === null ? {} : { fromMonth: from }),
      });
      setMsg({ ok: true, text: "Saved." });
      await onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e, "The pay rule was not saved.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="grid gap-2 py-3 @3xl:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] @3xl:items-start @3xl:gap-x-6">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {t.name}
          {!t.active ? <StatusChip tone="neutral" label="Archived" /> : null}
          {current === null ? (
            <StatusChip
              tone={t.bookingsThisMonth ? "serious" : "neutral"}
              label="No pay rule yet"
            />
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {[
            `${t.bookingsThisMonth ? plural(t.bookingsThisMonth, "booking") : "No bookings"} this month`,
            t.deducted ? "uses the allowance" : "outside the allowance",
            t.requiresApproval ? null : "skips approval in Timetastic",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {current === null ? (
          <p className="mt-1 text-xs">
            {t.bookingsThisMonth
              ? `Set a pay rule: ${plural(t.bookingsThisMonth, "booking waits", "bookings wait")} on it.`
              : "Set a pay rule before anyone books it."}
            {t.suggested ? (
              <span className="text-muted-foreground">{` Suggested from the name: ${RULE_LABEL[t.suggested]}.`}</span>
            ) : null}
          </p>
        ) : t.ruleFromMonth && t.ruleFromMonth > "2000-01" ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {`This rule since ${monthLabel(t.ruleFromMonth)} ${t.ruleFromMonth.slice(0, 4)}`}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Pays</span>
          <AnimatedSelect
            aria-label={`What ${t.name} pays`}
            value={rule}
            disabled={busy}
            onChange={e => setRule(e.target.value as Rule)}
            className="ceo-select-sm min-w-0 flex-1"
          >
            {(Object.keys(RULE_LABEL) as Rule[]).map(r => (
              <option key={r} value={r}>
                {RULE_LABEL[r]}
              </option>
            ))}
          </AnimatedSelect>
          {rule === "part" ? (
            <span className="flex items-center gap-1">
              <input
                aria-label={`Share of ${t.name} that is paid, percent`}
                value={share}
                inputMode="decimal"
                onChange={e => setShare(e.target.value)}
                className="h-8 w-16 rounded-md border bg-background px-2 text-right font-mono text-sm tabular-nums"
              />
              <span className="text-xs text-muted-foreground">% paid</span>
            </span>
          ) : null}
        </div>
        {changed ? (
          <div className="flex flex-wrap items-center gap-2">
            {current !== null ? (
              <>
                <span className="text-xs text-muted-foreground">
                  From which month?
                </span>
                <AnimatedSelect
                  aria-label="Applies from"
                  value={from}
                  onChange={e => setFrom(e.target.value)}
                  className="ceo-select-sm"
                >
                  {months.map(m => (
                    <option key={m} value={m}>
                      {`${monthLabel(m)} ${m.slice(0, 4)}`}
                    </option>
                  ))}
                </AnimatedSelect>
              </>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="teal"
              disabled={busy || !validShare}
              onClick={submit}
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {current === null ? "Save pay rule" : "Save change"}
            </Button>
            {current !== null ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setRule(current)}
              >
                Cancel
              </Button>
            ) : null}
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
      </div>
    </li>
  );
}

export function LeaveTypes({
  view,
  onChanged,
}: {
  view: HoursView;
  onChanged: () => Promise<void> | void;
}) {
  const types = [...view.inputs.leaveTypes].sort(
    (a, b) =>
      Number(a.payRule !== null) - Number(b.payRule !== null) ||
      b.bookingsThisMonth - a.bookingsThisMonth ||
      a.name.localeCompare(b.name),
  );
  if (!types.length)
    return (
      <p className="text-sm text-muted-foreground">
        No leave types read yet. They come from Timetastic on the nightly read,
        or press Sync now in Connections.
      </p>
    );
  return (
    <div className="grid gap-2">
      <ul className="divide-y">
        {types.map(t => (
          <TypeRow
            key={`${t.externalId}-${t.payRule ?? "none"}-${t.paidShare ?? ""}`}
            t={t}
            today={view.inputs.today}
            onChanged={onChanged}
          />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Suggestions come from the name: Holiday and Annual are paid, Unpaid is
        unpaid, Sick is paid in full, Working from home and Meeting are not time
        off. Maternity, Paternity and Compassionate are paid. Pending and
        declined bookings never count.
      </p>
    </div>
  );
}
