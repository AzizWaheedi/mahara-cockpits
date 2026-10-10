import { Check, ChevronRight, Link2, Loader2, Undo2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import {
  count,
  decimal,
  kuwaitDay,
  pct,
  relative,
  shortDate,
} from "@/components/ceo/format";
import { StatusChip } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { HoursView } from "@/lib/ceoHoursClient";
import { api, useAction } from "@/lib/cockpitApi";
import { cn } from "@/lib/utils";
import type {
  Adjustment,
  AdjustmentKind,
  PersonInputs,
  PersonMonth,
  Reason,
  Ymd,
} from "@/types/ceo/hoursContract";
import { nowSentence, owedAfterLeaving } from "./HoursMonthView";
import {
  BASIS_LABEL,
  DECISION_REASON,
  statusChip,
  TRACKING_LABEL,
  undecidedDays,
} from "./hoursCopy";
import {
  dayLabel,
  hm,
  monthLabel,
  parseHours,
  pay,
  signedHm,
  signedPay,
} from "./hoursFormat";
import { decideDaysOf, MonthCalendar, RibbonLegend } from "./MonthRibbon";

/**
 * One person's month (design 5.4): the ribbon as a calendar, the month as a
 * receipt, the questions that are really open (only the four in 4.5), and
 * where every number comes from. A side panel on a laptop, a full-screen
 * sheet on a phone.
 */

function errorText(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return raw.split("\n")[0].trim() || fallback;
}

/** What a decision reads as once made: the action said in the past. */
const DONE: Partial<Record<AdjustmentKind, string>> = {
  absent_unpaid: "Confirmed absent",
  excused_paid: "Counted as worked",
  hours: "Hours entered",
  count_work: "Counted",
  manual_time: "Manual time decided",
  not_booked: "Treated as not booked",
  no_leave_month: "No leave this month",
  overtime: "Overtime approved",
  leave: "Leave set",
};

function Line({
  label,
  value,
  note,
  strong,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-1",
        strong && "border-t pt-2 font-semibold",
      )}
    >
      <dt className="min-w-0 text-sm">
        {label}
        {note ? (
          <span className="block text-xs font-normal text-muted-foreground">
            {note}
          </span>
        ) : null}
      </dt>
      <dd className="text-right font-mono text-sm font-medium tabular-nums">
        {value}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

type Act = (
  label: string,
  fn: () => Promise<unknown>,
  done: string,
) => Promise<void>;

/** One open question about one day (or the month), each answer one click. */
function Decision({
  p,
  person,
  reason,
  day,
  month,
  act,
  busy,
}: {
  p: PersonMonth;
  person: PersonInputs | undefined;
  reason: Reason;
  day: Ymd | null;
  month: string;
  act: Act;
  busy: string | null;
}) {
  const adjust = useAction(api.ceo.hours.adjust);
  const withdraw = useAction(api.ceo.hours.withdrawAdjustment);
  const [why, setWhy] = useState("");
  const [whyOpen, setWhyOpen] = useState(false);
  const [entering, setEntering] = useState(false);
  const [entered, setEntered] = useState("");
  const dv = day ? p.days.find(d => d.day === day) : undefined;
  const key = `${reason.code}:${day ?? "month"}`;
  const base = {
    personId: p.personId,
    month,
    day,
    seconds: null,
    mode: null,
    paidShare: null,
    decision: null,
    bookingId: null,
    amount: null,
    currency: null,
    fromMonth: null,
  } as const;
  const send = (
    label: string,
    patch: Partial<Adjustment>,
    defaultReason: string,
    done: string,
  ) =>
    act(
      `${key}:${label}`,
      () => adjust({ ...base, ...patch, reason: why.trim() || defaultReason }),
      done,
    );
  const working = busy?.startsWith(key) ?? false;
  const seconds = parseHours(entered);
  const pendingBookings = (person?.bookings ?? []).filter(
    b =>
      b.status === "Pending" &&
      (!day || (b.startAt.slice(0, 10) <= day && b.endAt.slice(0, 10) >= day)),
  );
  const hoursAdj = (person?.adjustments ?? []).find(
    a => a.kind === "hours" && a.day === day,
  );

  let title: string;
  let buttons: ReactNode;
  switch (reason.code) {
    case "absent_no_leave":
      title = `${dv ? dayLabel(dv.day) : "A day"} · ${
        dv && dv.paidLeave + dv.unpaid > 0
          ? "half a day of leave, nothing tracked"
          : "nothing tracked, no leave booked"
      }`;
      buttons = (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={working}
            onClick={() =>
              send(
                "absent",
                { kind: "absent_unpaid" },
                DECISION_REASON.absent,
                "Confirmed absent",
              )
            }
          >
            Confirm absent
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={working}
            onClick={() =>
              send(
                "excused",
                { kind: "excused_paid" },
                DECISION_REASON.excused,
                "Counted as worked",
              )
            }
          >
            Count as worked
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={working}
            aria-expanded={entering}
            onClick={() => setEntering(v => !v)}
          >
            Enter hours
          </Button>
        </>
      );
      break;
    case "manual_time":
      title = `Manual time this month: ${hm(reason.seconds ?? 0)} not decided yet`;
      buttons = (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={working}
            onClick={() =>
              send(
                "count",
                {
                  kind: "manual_time",
                  day: null,
                  decision: "count",
                  seconds: reason.seconds ?? null,
                },
                DECISION_REASON.manualCount,
                "Manual time counted",
              )
            }
          >
            Count it
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={working}
            onClick={() =>
              send(
                "skip",
                {
                  kind: "manual_time",
                  day: null,
                  decision: "skip",
                  seconds: reason.seconds ?? null,
                },
                DECISION_REASON.manualSkip,
                "Manual time not counted",
              )
            }
          >
            Don't count it
          </Button>
        </>
      );
      break;
    case "pending_leave":
      title = `${dv ? dayLabel(dv.day) : "Leave"} · ${
        pendingBookings[0]?.leaveTypeName ?? "Leave"
      } still pending in Timetastic`;
      buttons = (
        <>
          <span className="self-center text-xs text-muted-foreground">
            Approve or decline it in Timetastic, or
          </span>
          {pendingBookings.slice(0, 1).map(b => (
            <Button
              key={b.bookingId}
              type="button"
              size="sm"
              variant="outline"
              disabled={working}
              onClick={() =>
                send(
                  "notBooked",
                  { kind: "not_booked", day: null, bookingId: b.bookingId },
                  DECISION_REASON.notBooked,
                  "Treated as not booked",
                )
              }
            >
              Treat as not booked
            </Button>
          ))}
        </>
      );
      break;
    case "entered_vs_hubstaff":
      title = `${dv ? dayLabel(dv.day) : "A day"} · you entered ${hm(hoursAdj?.seconds ?? 0)}, Hubstaff now shows ${hm(dv?.tracked ?? 0)}`;
      buttons = (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={working || !hoursAdj}
            onClick={() =>
              send(
                "keep",
                {
                  kind: "hours",
                  mode: "replace",
                  seconds: hoursAdj?.seconds ?? null,
                },
                DECISION_REASON.keepEntered,
                "Kept",
              )
            }
          >
            {`Keep ${hm(hoursAdj?.seconds ?? 0)}`}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={working || !hoursAdj}
            onClick={() =>
              hoursAdj
                ? act(
                    `${key}:use`,
                    () =>
                      withdraw({
                        id: hoursAdj.id,
                        reason: why.trim() || DECISION_REASON.useHubstaff,
                      }),
                    "Using Hubstaff's time",
                  )
                : Promise.resolve()
            }
          >
            {`Use Hubstaff's ${hm(dv?.tracked ?? 0)}`}
          </Button>
        </>
      );
      break;
    default:
      return null;
  }

  return (
    <li className="grid gap-2 py-3">
      <p className="text-sm">{title}</p>
      <div className="flex flex-wrap gap-2">
        {buttons}
        {working ? (
          <Loader2
            className="size-4 animate-spin self-center text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </div>
      {entering ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={e => {
            e.preventDefault();
            if (seconds === null) return;
            void send(
              "hours",
              {
                kind: "hours",
                seconds,
                mode: dv?.counted === null ? "replace" : "add",
              },
              DECISION_REASON.hours,
              "Hours entered",
            ).then(() => setEntering(false));
          }}
        >
          <input
            value={entered}
            onChange={e => setEntered(e.target.value)}
            placeholder="7:30"
            inputMode="decimal"
            aria-label={`Hours worked on ${dv ? dayLabel(dv.day) : "this day"}`}
            className="h-8 w-24 rounded-md border bg-background px-2 font-mono text-sm tabular-nums"
          />
          <Button
            type="submit"
            size="sm"
            disabled={seconds === null || working}
          >
            Save hours
          </Button>
          <span className="text-xs text-muted-foreground">
            {seconds === null
              ? "Hours and minutes, like 7:30."
              : `${hm(seconds)} on ${dv ? dayLabel(dv.day) : "this day"}`}
          </span>
        </form>
      ) : null}
      {whyOpen ? (
        <input
          value={why}
          onChange={e => setWhy(e.target.value)}
          maxLength={300}
          placeholder="Your reason, used by whichever choice you press"
          aria-label="Reason for this decision"
          className="h-8 w-full rounded-md border bg-background px-2 text-xs"
        />
      ) : (
        <button
          type="button"
          onClick={() => setWhyOpen(true)}
          className="w-fit text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Write your own reason
        </button>
      )}
    </li>
  );
}

export function PersonSheet({
  view,
  personId,
  now,
  onClose,
  onChanged,
  onApprove,
  onGoLink,
  onGoSettings,
}: {
  view: HoursView;
  personId: number | null;
  now: number;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onApprove: (p: PersonMonth) => void;
  onGoLink: () => void;
  onGoSettings: (personId: number) => void;
}) {
  const p = view.people.find(x => x.personId === personId) ?? null;
  return (
    <Sheet open={p !== null} onOpenChange={open => (open ? null : onClose())}>
      <SheetContent
        side="right"
        className="ceo-root w-full max-w-none overflow-y-auto p-0 sm:max-w-xl"
      >
        {p ? (
          <PersonBody
            key={`${view.month}-${p.personId}`}
            view={view}
            p={p}
            now={now}
            onChanged={onChanged}
            onApprove={onApprove}
            onGoLink={onGoLink}
            onGoSettings={onGoSettings}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function PersonBody({
  view,
  p,
  now,
  onChanged,
  onApprove,
  onGoLink,
  onGoSettings,
}: {
  view: HoursView;
  p: PersonMonth;
  now: number;
  onChanged: () => Promise<void> | void;
  onApprove: (p: PersonMonth) => void;
  onGoLink: () => void;
  onGoSettings: (personId: number) => void;
}) {
  const withdrawAdj = useAction(api.ceo.hours.withdrawAdjustment);
  const withdrawApproval = useAction(api.ceo.hours.withdrawApproval);
  const markPaid = useAction(api.ceo.hours.markPaid);
  const adjust = useAction(api.ceo.hours.adjust);
  const person = view.inputs.people.find(x => x.personId === p.personId);
  const decide = useMemo(() => decideDaysOf(p.status.reasons), [p]);
  const firstDecide = p.days.find(d => decide.has(d.day))?.day ?? null;
  const [selected, setSelected] = useState<Ymd | null>(
    firstDecide ?? p.days.find(d => d.kind === "today")?.day ?? null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [withdrawing, setWithdrawing] = useState<number | "approval" | null>(
    null,
  );
  const [withdrawWhy, setWithdrawWhy] = useState("");
  const [paying, setPaying] = useState(false);
  const [paidOn, setPaidOn] = useState(kuwaitDay(now));
  const [paidNote, setPaidNote] = useState("");

  const act: Act = async (label, fn, done) => {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: done });
      await onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e, "That did not go through.") });
    } finally {
      setBusy(null);
    }
  };

  const chip = statusChip(p);
  const fixed = !p.paysOnHours && !p.shadow;
  const h = p.hours;
  const undecided = undecidedDays(p);
  const month = view.month;
  const mName = monthLabel(month);
  const owed = owedAfterLeaving(view, p.personId);
  const blocks = p.status.reasons.filter(r => r.severity === "blocks");
  const questions = p.status.reasons.filter(r => r.severity === "decide");
  const notes = p.status.reasons.filter(r => r.severity === "note");
  const made = (person?.adjustments ?? []).filter(
    a => a.kind !== "correction" && a.month === month,
  );
  const sel = selected ? p.days.find(d => d.day === selected) : undefined;
  const hub = view.sources.find(s => s.provider === "hubstaff");
  const tt = view.sources.find(s => s.provider === "timetastic");
  const hubAt = hub?.lastOkAt ? Date.parse(hub.lastOkAt) : null;
  const ttAt = tt?.lastOkAt ? Date.parse(tt.lastOkAt) : null;
  const unverified = p.days.filter(d => d.kind === "unverified").length;
  // The latest base on record, as the rule's value per hour uses it.
  const base =
    [...p.segments].reverse().find(s => s.base !== null)?.base ?? null;
  const terms = person?.terms;
  const pf = terms?.hoursPayFrom;

  const header = [
    p.role ?? "No role set",
    TRACKING_LABEL[p.tracking.value],
    p.paysOnHours
      ? `Pay follows hours${pf ? ` from ${monthLabel(pf)} ${pf.slice(0, 4)}` : ""}`
      : p.shadow
        ? `Pay follows hours${pf ? ` from ${monthLabel(pf)} ${pf.slice(0, 4)}` : " once switched"} (shadow until then)`
        : `${BASIS_LABEL[p.payBasis.value]} pay`,
  ].join(" · ");

  const linkMissing = blocks.some(r => r.code === "hubstaff_not_linked");
  const timetasticMissing = blocks.some(r => r.code === "timetastic_not_read");
  const ttLinked = person?.accounts.some(a => a.provider === "timetastic");

  return (
    <div className="@container grid gap-6 p-4 pb-10 sm:p-6">
      <SheetHeader className="space-y-1 p-0 pr-8 text-left">
        <SheetTitle className="text-lg font-semibold">{p.name}</SheetTitle>
        <SheetDescription className="text-xs text-muted-foreground">
          {owed ? `Owed after leaving · ${header}` : header}
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <StatusChip tone={chip.tone} label={chip.label} size="md" />
          {p.now ? (
            <span className="text-xs text-muted-foreground">
              {p.now.kind === "tracking"
                ? `Tracking now · ${hm(p.now.trackedToday)} today`
                : `Now: ${nowSentence(p.now, now)}`}
            </span>
          ) : null}
        </div>
      </SheetHeader>

      {blocks.length ? (
        <div className="ceo-stale grid gap-1 rounded-lg border px-3 py-2 text-sm">
          <p className="font-medium">Not ready</p>
          <ul className="grid gap-0.5">
            {blocks.map(r => (
              <li key={r.code}>{r.text}</li>
            ))}
          </ul>
          <div className="mt-1 flex flex-wrap gap-2">
            {linkMissing ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onGoLink}
              >
                <Link2 aria-hidden />
                Link
              </Button>
            ) : null}
            {timetasticMissing && !ttLinked ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  act(
                    "noLeave",
                    () =>
                      adjust({
                        personId: p.personId,
                        kind: "no_leave_month",
                        month,
                        day: null,
                        seconds: null,
                        mode: null,
                        paidShare: null,
                        decision: null,
                        bookingId: null,
                        amount: null,
                        currency: null,
                        fromMonth: null,
                        reason: DECISION_REASON.noLeave,
                      }),
                    "Recorded: no leave this month",
                  )
                }
              >
                No leave this month
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3">
        <MonthCalendar
          days={p.days}
          decide={decide}
          fixed={fixed}
          selected={selected}
          onSelect={setSelected}
        />
        <RibbonLegend fixed={fixed} />
        {sel ? (
          <div
            className="rounded-xl bg-muted/40 p-3 text-sm"
            aria-live="polite"
          >
            <p className="font-medium">{sel.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[
                sel.expected
                  ? `${hm(sel.expected)} expected`
                  : "Not a working day",
                fixed
                  ? null
                  : sel.tracked === null
                    ? "no Hubstaff data"
                    : `${hm(sel.tracked)} tracked`,
                sel.paidLeave ? `${hm(sel.paidLeave)} paid leave` : null,
                sel.unpaid ? `${hm(sel.unpaid)} unpaid` : null,
                sel.holiday ? sel.holiday : null,
                ...sel.leave.map(
                  l =>
                    `${l.name}${l.part === "am" ? " (morning)" : l.part === "pm" ? " (afternoon)" : l.part === "hours" ? " (hours)" : ""}${l.status === "Approved" ? "" : `, ${l.status.toLowerCase()}`}`,
                ),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        ) : null}
      </div>

      <Section title="The month, line by line">
        <dl className="grid">
          <Line label="Expected while employed" value={hm(h.expected)} />
          {h.unpaid ? (
            <Line
              label="Unpaid leave and absences"
              value={`−${hm(h.unpaid)}`}
              note={
                undecided.days
                  ? `Includes ${count(undecided.days)} day${undecided.days === 1 ? "" : "s"} not decided yet (${hm(undecided.seconds)}), counted as absent until you decide them below`
                  : undefined
              }
            />
          ) : null}
          <Line label="Target" value={hm(h.target)} strong />
          <Line
            label="Tracked (Hubstaff)"
            value={h.tracked === null ? "no data" : hm(h.tracked)}
            note={
              fixed
                ? "Fixed pay: tracked time is shown for information"
                : h.manual
                  ? `${hm(h.manual)} manual, ${h.manualCounted === null ? "not decided" : h.manualCounted >= h.manual ? "counted" : `${hm(h.manualCounted)} counted`}`
                  : undefined
            }
          />
          {fixed ? null : (
            <>
              <Line label="Paid leave (Timetastic)" value={hm(h.paidLeave)} />
              <Line label="Public holidays" value={hm(h.holidays)} />
              {h.excused ? (
                <Line label="Counted as worked" value={hm(h.excused)} />
              ) : null}
              {h.entered ? (
                <Line label="Hours you entered" value={hm(h.entered)} />
              ) : null}
              {h.noData ? (
                <Line
                  label={
                    p.paysOnHours
                      ? "Days with no data, paid as worked for now"
                      : "Days with no data, counted as worked for now"
                  }
                  value={hm(h.noData)}
                />
              ) : null}
              <Line
                label="Counted"
                value={h.counted === null ? "no data" : hm(h.counted)}
                strong
              />
              {h.forgiven ? (
                <Line
                  label={`Forgiven (${pct(view.settings.graceShare)} of target)`}
                  value={hm(h.forgiven)}
                />
              ) : null}
              <Line
                label="Payable"
                value={h.payable === null ? "n/a" : hm(h.payable)}
              />
              {h.extra ? (
                <Line
                  label="Extra, shown not paid"
                  value={hm(h.extra)}
                  note={
                    view.settings.overtime.on
                      ? "Overtime is paid only above target, when approved"
                      : "Pay never goes above base"
                  }
                />
              ) : null}
              {p.pay.valuePerHour !== null && base !== null ? (
                <Line
                  label="Value per hour"
                  value={pay(p.pay.valuePerHour, p.currency)}
                  note={`Base ${pay(base, p.currency)} ÷ ${hm(h.fullMonth)} in ${mName}`}
                />
              ) : null}
            </>
          )}
          {p.segments.length > 1
            ? p.segments.map(s => (
                <Line
                  key={s.from}
                  label={`${shortDate(s.from)} to ${shortDate(s.to)}`}
                  note={`${s.base === null ? "No pay set" : `Base ${pay(s.base, p.currency)}`}, ${hm(s.payable)} of ${hm(s.target)}`}
                  value={pay(s.amount, p.currency)}
                />
              ))
            : null}
          {p.pay.overtime ? (
            <Line
              label="Overtime"
              value={pay(p.pay.overtime, p.currency)}
              note={`${hm(h.overtimePaid)} at ${view.settings.overtime.rate}`}
            />
          ) : null}
          {p.pay.corrections.lines.map((c, i) => (
            <Line
              key={i}
              label={
                c.fromMonth
                  ? `Carried from ${monthLabel(c.fromMonth)}`
                  : "Correction"
              }
              value={signedPay(c.applied, p.currency)}
              note={
                c.applied === c.amount
                  ? undefined
                  : p.pay.corrections.carriedOut < 0
                    ? `${signedPay(c.amount - c.applied, p.currency)} carried into next month (at most ${pct(view.settings.correctionCapShare)} of a month's pay)`
                    : `Not recovered: ${pay(c.applied - c.amount, p.currency)}. They have left, and at most ${pct(view.settings.correctionCapShare)} of a month's pay is taken`
              }
            />
          ))}
          <Line
            label={`Pay for ${mName}`}
            value={p.pay.total === null ? "n/a" : pay(p.pay.total, p.currency)}
            note={
              p.pay.provisional
                ? "Provisional: days with no data are paid as worked until they are read"
                : p.pay.total === null
                  ? (blocks[0]?.text ?? "Not worked out yet")
                  : undecided.days
                    ? `Not final: ${undecided.days === 1 ? "1 undecided day counts" : `${count(undecided.days)} undecided days count`} as absent until you decide`
                    : undefined
            }
            strong
          />
          {p.shadow && p.pay.shadowAmount !== null ? (
            <Line
              label="If pay followed hours"
              value={pay(p.pay.shadowAmount, p.currency)}
              note={[
                p.pay.shadowUndecidedDays
                  ? `${count(p.pay.shadowUndecidedDays)} day${p.pay.shadowUndecidedDays === 1 ? "" : "s"} undecided, counted as absent.`
                  : null,
                h.noData
                  ? `${hm(h.noData)} with no data, counted as worked.`
                  : null,
                p.pay.shadowUndecidedDays || h.noData
                  ? "Shadow: nothing waits on it."
                  : "Shadow: shown for comparison, never paid",
              ]
                .filter(Boolean)
                .join(" ")}
            />
          ) : null}
        </dl>
        {p.changedSinceApproval ? (
          <p className="ceo-stale rounded-lg border px-3 py-2 text-sm">
            {`Changed since approved: ${signedHm(p.changedSinceApproval.seconds)}, ${signedPay(p.changedSinceApproval.amount, p.currency)}, carried into the next month when you approve it.`}
          </p>
        ) : null}
        {notes.length ? (
          <ul className="grid gap-1 text-xs text-muted-foreground">
            {notes.map(r => (
              <li
                key={`${r.code}-${r.days?.[0] ?? ""}`}
                className="flex flex-wrap items-baseline gap-x-2"
              >
                <span>{r.text}</span>
                {(r.code === "over_day_limit" ||
                  r.code === "idle_not_counted") &&
                r.days?.length === 1 &&
                r.seconds ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      act(
                        `count:${r.days?.[0]}`,
                        () =>
                          adjust({
                            personId: p.personId,
                            kind: "count_work",
                            month,
                            day: r.days?.[0] ?? null,
                            seconds: r.seconds ?? null,
                            mode: null,
                            paidShare: null,
                            decision: null,
                            bookingId: null,
                            amount: null,
                            currency: null,
                            fromMonth: null,
                            reason: "Checked: the time was worked",
                          }),
                        "Counted",
                      )
                    }
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    Count it
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {questions.length ? (
        <Section title="Needs your decision">
          <ul className="divide-y">
            {questions.flatMap(r =>
              r.days?.length
                ? r.days.map(d => (
                    <Decision
                      key={`${r.code}-${d}`}
                      p={p}
                      person={person}
                      reason={r}
                      day={d}
                      month={month}
                      act={act}
                      busy={busy}
                    />
                  ))
                : [
                    <Decision
                      key={r.code}
                      p={p}
                      person={person}
                      reason={r}
                      day={null}
                      month={month}
                      act={act}
                      busy={busy}
                    />,
                  ],
            )}
          </ul>
        </Section>
      ) : null}

      {msg ? (
        <p
          aria-live="polite"
          className={cn(
            "text-sm",
            msg.ok ? "text-foreground" : "text-[var(--ceo-critical)]",
          )}
        >
          {msg.ok ? (
            <Check
              className="mr-1 inline size-4 text-[var(--ceo-good)]"
              aria-hidden
            />
          ) : null}
          {msg.text}
        </p>
      ) : null}

      {made.length ? (
        <Section title="Your decisions this month">
          <ul className="grid gap-1.5">
            {made.map(a => (
              <li key={a.id} className="grid gap-1.5 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">
                    {DONE[a.kind] ?? a.kind}
                    {a.kind === "hours" && a.seconds
                      ? ` (${hm(a.seconds)})`
                      : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {[a.day ? dayLabel(a.day) : mName, a.reason].join(" · ")}
                  </span>
                  {withdrawing === a.id ? null : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      disabled={busy !== null}
                      onClick={() => {
                        setWithdrawWhy("Decided by mistake");
                        setWithdrawing(a.id);
                      }}
                    >
                      <Undo2 aria-hidden />
                      Withdraw
                    </Button>
                  )}
                </div>
                {withdrawing === a.id ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={e => {
                      e.preventDefault();
                      void act(
                        `withdraw:${a.id}`,
                        () => withdrawAdj({ id: a.id, reason: withdrawWhy }),
                        "Withdrawn",
                      ).then(() => setWithdrawing(null));
                    }}
                  >
                    <input
                      value={withdrawWhy}
                      onChange={e => setWithdrawWhy(e.target.value)}
                      aria-label="Why it is withdrawn"
                      className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={withdrawWhy.trim().length < 3 || busy !== null}
                    >
                      Withdraw
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setWithdrawing(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="grid gap-1 text-sm">
        {p.leaveLeft ? (
          <p>
            {`Leave this year: ${decimal(p.leaveLeft.amount)} ${p.leaveLeft.unit === "Hours" ? "hours" : p.leaveLeft.amount === 1 ? "day" : "days"} left`}
            <span className="text-muted-foreground"> (Timetastic)</span>
          </p>
        ) : null}
        {!fixed || p.activity.share !== null ? (
          <p>
            {`Activity: ${p.activity.share === null ? "n/a" : pct(p.activity.share)}`}
            <span className="text-muted-foreground">
              {" "}
              (phone and web timer time has no activity level; it never changes
              pay)
            </span>
          </p>
        ) : null}
      </div>

      <Section title="Where these numbers come from">
        <dl className="grid gap-2 text-xs leading-5 text-muted-foreground">
          <div>
            <dt className="inline font-medium text-foreground">Tracked: </dt>
            <dd className="inline">
              {`Hubstaff's 10-minute records sorted into Kuwait days${hubAt ? `, read ${relative(hubAt, now)}` : ""}; checked against Hubstaff's daily totals: ${unverified ? `${count(unverified)} day${unverified === 1 ? "" : "s"} differ, so approval waits for the next read` : "all days match within 1 min"}. Leaves out time added after the last read.`}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">Leave: </dt>
            <dd className="inline">
              {`Timetastic approved bookings${ttAt ? `, read ${relative(ttAt, now)}` : ""}, checked day by day against Timetastic's own absence list. Leaves out pending requests${questions.some(q => q.code === "pending_leave") ? " (listed above)" : ""}.`}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">Expected: </dt>
            <dd className="inline">
              {`The hours on the roster in force each day, minus a ${hm(view.settings.breakMinutes * 60)} break on days longer than ${view.settings.breakWhenLongerThanHours} h.`}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">Pay: </dt>
            <dd className="inline">
              {`The base in force each day; worked out by rule ${view.ruleVersion} in the browser and again on the server at approval. Approved figures never change; later changes are carried.`}
            </dd>
          </div>
        </dl>
      </Section>

      {p.approval ? (
        <Section
          title={
            p.approval.status === "paid"
              ? `Paid ${p.approval.paidAt ? shortDate(p.approval.paidAt.slice(0, 10)) : ""}`
              : `Approved ${shortDate(p.approval.approvedAt.slice(0, 10))}`
          }
        >
          <p className="text-sm">
            {`${pay(p.approval.amount, p.approval.currency)} for ${hm(p.approval.payableS)} payable${p.approval.shadow ? ", fixed pay (shadow month)" : ""}. Rule ${p.approval.ruleVersion}.`}
            {p.approval.paidNote ? (
              <span className="text-muted-foreground">{` ${p.approval.paidNote}`}</span>
            ) : null}
          </p>
          {p.approval.status === "approved" ? (
            <div className="grid gap-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-expanded={paying}
                  onClick={() => {
                    setPaying(v => !v);
                    setWithdrawing(null);
                  }}
                >
                  Mark paid
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-expanded={withdrawing === "approval"}
                  onClick={() => {
                    setPaying(false);
                    setWithdrawWhy("");
                    setWithdrawing(v => (v === "approval" ? null : "approval"));
                  }}
                >
                  Withdraw approval
                </Button>
              </div>
              {paying ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={e => {
                    e.preventDefault();
                    void act(
                      "paid",
                      () =>
                        markPaid({
                          personId: p.personId,
                          month,
                          paidOn,
                          note: paidNote.trim() || undefined,
                        }),
                      "Marked paid",
                    ).then(() => setPaying(false));
                  }}
                >
                  <DateInput
                    value={paidOn}
                    onChange={e => setPaidOn(e.target.value)}
                    aria-label="Paid on"
                    className="ceo-select-sm w-40"
                  />
                  <input
                    value={paidNote}
                    onChange={e => setPaidNote(e.target.value)}
                    placeholder="Note (optional)"
                    aria-label="Note"
                    className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
                  />
                  <Button type="submit" size="sm" disabled={busy !== null}>
                    Mark paid
                  </Button>
                  <span className="basis-full text-xs text-muted-foreground">
                    Records the date only. Nothing is transferred.
                  </span>
                </form>
              ) : null}
              {withdrawing === "approval" ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={e => {
                    e.preventDefault();
                    void act(
                      "withdrawApproval",
                      () =>
                        withdrawApproval({
                          personId: p.personId,
                          month,
                          reason: withdrawWhy,
                        }),
                      "Approval withdrawn",
                    ).then(() => setWithdrawing(null));
                  }}
                >
                  <input
                    value={withdrawWhy}
                    onChange={e => setWithdrawWhy(e.target.value)}
                    placeholder="Why it is withdrawn"
                    aria-label="Why the approval is withdrawn"
                    className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={withdrawWhy.trim().length < 3 || busy !== null}
                  >
                    Withdraw approval
                  </Button>
                </form>
              ) : null}
            </div>
          ) : null}
        </Section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        {p.status.kind === "ready" ? (
          <Button type="button" onClick={() => onApprove(p)}>
            {`Approve ${mName}`}
          </Button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => onGoSettings(p.personId)}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {`Settings for ${p.name}`}
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
