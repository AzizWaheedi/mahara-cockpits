import { CalendarCheck, Link2, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { count, money, plural, relative, time } from "@/components/ceo/format";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import type { HoursView } from "@/lib/ceoHoursClient";
import { cn } from "@/lib/utils";
import type { NowFlag, PersonMonth } from "@/types/ceo/hoursContract";
import { sortPeople, statusChip, undecidedDays } from "./hoursCopy";
import { hm, hours, hoursDec, monthLabel, pay } from "./hoursFormat";
import { decideDaysOf, MonthRibbon } from "./MonthRibbon";

/**
 * The month view (design 5.3): five tiles, who should be tracking now and
 * isn't, then one row per person with the month ribbon, counted against
 * target, pay and a status chip with its first reason. Approving sits in one
 * bar at the foot: it is the deliberate end of the review, not a button on
 * every row.
 */

/** "10:00" from either a clock time or an ISO moment. */
function clock(v: string): string {
  if (/^\d{2}:\d{2}$/.test(v)) return v;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? time(ms) : v;
}

export function nowSentence(flag: NowFlag, now: number): string | null {
  switch (flag.kind) {
    case "not_tracking":
      return `no Hubstaff time since ${clock(flag.since)} (${hm(flag.seconds)})`;
    case "stopped":
      return `stopped at ${clock(flag.at)}`;
    case "cant_tell": {
      const ms = flag.lastReadAt ? Date.parse(flag.lastReadAt) : null;
      return `can't tell: Hubstaff last read ${ms ? relative(ms, now) : "a while ago"}`;
    }
    default:
      return null;
  }
}

/** True for someone carried into this month only to settle what was owed after they left. */
export function owedAfterLeaving(view: HoursView, personId: number): boolean {
  const p = view.inputs.people.find(x => x.personId === personId);
  return Boolean(p?.endedOn && p.endedOn < `${view.month}-01`);
}

function counts(p: PersonMonth) {
  // Fixed pay, or a month that only settles what was owed after leaving.
  const fixed =
    (!p.paysOnHours && !p.shadow) ||
    (p.hours.expected === 0 && p.hours.target === 0);
  return {
    fixed,
    counted: fixed
      ? "—"
      : p.hours.counted === null
        ? "no data"
        : hoursDec(p.hours.counted),
    target: hoursDec(p.hours.target),
  };
}

function PayCell({ p }: { p: PersonMonth }) {
  const approved = p.approval;
  if (approved)
    return (
      <span className="font-mono text-sm font-medium tabular-nums">
        {pay(approved.amount, approved.currency)}
      </span>
    );
  // Plain text: the row is a button already, and its label says why.
  if (p.pay.total === null)
    return <span className="text-sm text-muted-foreground">n/a</span>;
  return (
    <span className="inline-flex flex-col items-end leading-tight @4xl:items-end">
      <span className="font-mono text-sm font-medium tabular-nums">
        {pay(p.pay.total, p.currency)}
      </span>
      {p.pay.provisional ? (
        <span className="text-[11px] text-muted-foreground">provisional</span>
      ) : undecidedDays(p).days ? (
        <span className="text-[11px] text-muted-foreground">until decided</span>
      ) : null}
    </span>
  );
}

function PersonRow({
  p,
  owed,
  onOpen,
}: {
  p: PersonMonth;
  owed: boolean;
  onOpen: () => void;
}) {
  const chip = statusChip(p);
  const c = counts(p);
  const decide = useMemo(() => decideDaysOf(p.status.reasons), [p]);
  const role = owed ? "Owed after leaving" : (p.role ?? "No role set");
  const label = [
    `${p.name}, ${p.role ?? "no role"}`,
    c.fixed ? `fixed pay, target ${c.target}` : `${c.counted} of ${c.target}`,
    p.approval
      ? `approved ${pay(p.approval.amount, p.approval.currency)}`
      : p.pay.total === null
        ? "pay not worked out"
        : `${pay(p.pay.total, p.currency)}${p.pay.provisional ? " provisional" : undecidedDays(p).days ? " until decided" : ""}`,
    chip.label,
  ].join(", ");
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${label}. Open the month.`}
        className="group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-lg px-2 py-3 text-left transition-colors hover:bg-[var(--ceo-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring @4xl:grid-cols-[minmax(10rem,13rem)_minmax(0,1fr)_8.5rem_7rem_minmax(10rem,13rem)] @4xl:gap-x-4"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{p.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {role}
          </span>
        </span>
        <span className="justify-self-end @4xl:order-last @4xl:justify-self-start">
          <StatusChip
            tone={chip.tone}
            label={chip.label}
            className="max-w-[13rem]"
          />
        </span>
        <MonthRibbon
          days={p.days}
          decide={decide}
          fixed={c.fixed}
          className="col-span-2 @4xl:col-span-1"
        />
        <span className="text-xs text-muted-foreground @4xl:text-right">
          <span
            className={cn(
              "font-mono text-sm font-medium tabular-nums",
              c.counted === "no data"
                ? "text-muted-foreground"
                : "text-foreground",
            )}
          >
            {c.counted}
          </span>
          <span className="font-mono tabular-nums">{` / ${c.target}`}</span>
        </span>
        <span className="justify-self-end text-right">
          <PayCell p={p} />
        </span>
      </button>
    </li>
  );
}

export function HoursMonthView({
  view,
  now,
  onOpen,
  onApprove,
  onGoLink,
  onGoLeave,
}: {
  view: HoursView;
  now: number;
  onOpen: (personId: number) => void;
  onApprove: (people: PersonMonth[]) => void;
  onGoLink: () => void;
  onGoLeave: () => void;
}) {
  const people = useMemo(() => sortPeople(view.people), [view.people]);
  const t = view.totals;
  const ready = people.filter(p => p.status.kind === "ready");
  const decide = people.filter(p => p.status.kind === "needs_review");
  const blocked = people.filter(p => p.status.kind === "not_ready");
  const unlinked = people.filter(p =>
    p.status.reasons.some(r => r.code === "hubstaff_not_linked"),
  );
  const notNow = view.notTrackingNow
    .map(n => ({ ...n, text: nowSentence(n.flag, now) }))
    .filter(n => n.text);
  const notCounted = view.notCounted;
  const nc = (why: (typeof notCounted)[number]["why"]) =>
    notCounted.filter(x => x.why === why);
  const ceo = nc("ceo").length;
  const bots = nc("bot").length;
  const noRole = nc("no_role");
  const monthName = monthLabel(view.month);

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 @xl:grid-cols-3 @4xl:grid-cols-5">
        <StatTile
          variant="plain"
          label="Expected"
          value={hours(t.expected)}
          hint="The roster's hours for everyone counted, minus a 1 h break on days longer than 6 h."
        />
        <StatTile
          variant="plain"
          label="Counted"
          value={t.counted === null ? null : hours(t.counted)}
          naHint="Some days have no Hubstaff data yet, so the month can't be totalled."
          hint="Tracked time, paid leave, public holidays and days you counted as worked, for the people whose pay follows hours or is in shadow."
        />
        <StatTile
          variant="plain"
          label="Paid leave"
          value={hours(t.paidLeave)}
          hint="Approved Timetastic leave on the pay rules you set, inside each person's working hours."
        />
        <StatTile
          variant="plain"
          label="Pay this month"
          value={t.payUsd === null ? null : money(t.payUsd)}
          naHint={
            t.payMissing.length
              ? `Pay isn't worked out yet for ${t.payMissing.join(", ")}. Their rows say why.`
              : "Pay isn't worked out for everyone yet. The rows say why."
          }
          status={
            t.payProvisional ? (
              <StatusChip
                tone="neutral"
                label="provisional"
                hint="Some days have no data yet. Until they do, those days are paid as worked."
              />
            ) : null
          }
          sub="In dollars, at the Costs page's fixed rates"
        />
        <StatTile
          variant="plain"
          label="Ready to approve"
          value={`${count(t.byStatus.ready)} of ${count(people.length)}`}
          sub={
            t.byStatus.approved + t.byStatus.paid
              ? `${count(t.byStatus.approved + t.byStatus.paid)} approved already`
              : undefined
          }
        />
      </div>

      {notNow.length ? (
        <div
          role="status"
          className="ceo-stale flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
        >
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0"
            style={{ color: "var(--ceo-warning)" }}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="font-medium">Not tracking now</p>
            <ul className="mt-0.5 grid gap-0.5">
              {notNow.map(n => (
                <li key={n.personId}>
                  <button
                    type="button"
                    onClick={() => onOpen(n.personId)}
                    className="text-left underline-offset-4 hover:underline"
                  >
                    {`${n.role ?? "No role"} (${n.name}): ${n.text}.`}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">
              Nothing is sent to anyone.
            </p>
          </div>
        </div>
      ) : null}

      {view.leaveTypesWithoutRule.length ? (
        <div className="ceo-stale flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
          <p className="min-w-0">
            {view.leaveTypesWithoutRule
              .map(
                l =>
                  `Set a pay rule for ${l.name}: ${plural(l.bookings, "booking waits", "bookings wait")} on it.`,
              )
              .join(" ")}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={onGoLeave}>
            Set pay rules
          </Button>
        </div>
      ) : null}

      {people.length ? (
        <div>
          <div className="hidden px-2 pb-2 text-xs text-muted-foreground @4xl:grid @4xl:grid-cols-[minmax(10rem,13rem)_minmax(0,1fr)_8.5rem_7rem_minmax(10rem,13rem)] @4xl:gap-x-4">
            <span>Person</span>
            <span className="flex justify-between font-mono text-[10px]">
              <span>1</span>
              <span>{monthName}</span>
              <span>{view.people[0]?.days.length ?? ""}</span>
            </span>
            <span className="text-right">Counted / target</span>
            <span className="text-right">Pay</span>
            <span>Status</span>
          </div>
          <ul className="-mx-2 divide-y">
            {people.map(p => (
              <PersonRow
                key={p.personId}
                p={p}
                owed={owedAfterLeaving(view, p.personId)}
                onOpen={() => onOpen(p.personId)}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {unlinked.length ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <Link2 className="size-4 text-muted-foreground" aria-hidden />
          <span className="min-w-0">
            {`Required, without a Hubstaff link: ${unlinked.map(p => `${p.role ?? "No role"} (${p.name})`).join(", ")}. Their days are no data until linked.`}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={onGoLink}>
            Link
          </Button>
        </div>
      ) : null}

      {ceo || bots || noRole.length || nc("not_employed").length ? (
        <p className="text-xs text-muted-foreground">
          {[
            ceo || bots
              ? `Not counted: ${[ceo ? "the CEO" : null, bots ? plural(bots, "shared account") : null].filter(Boolean).join(", ")}.`
              : null,
            noRole.length
              ? `No role: ${noRole.map(x => x.name).join(", ")}. Set a role in On the team to work out pay.`
              : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}

      {ready.length || decide.length || blocked.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            {[
              ready.length ? `${count(ready.length)} ready` : null,
              decide.length
                ? `${count(decide.length)} need${decide.length === 1 ? "s" : ""} a decision`
                : null,
              blocked.length ? `${count(blocked.length)} not ready` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {ready.length ? (
            <Button type="button" onClick={() => onApprove(ready)}>
              <CalendarCheck aria-hidden />
              {`Approve ${count(ready.length)}`}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Approving opens once someone is ready.
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
