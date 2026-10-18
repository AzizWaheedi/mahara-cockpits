import {
  Check,
  ChevronRight,
  CircleDashed,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { Facts } from "@/components/ceo/Facts";
import { FilterChips } from "@/components/ceo/FilterChips";
import { count, money, plural, shortDate } from "@/components/ceo/format";
import { KICKER } from "@/components/ceo/Kicker";
import { Na } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip } from "@/components/ceo/StatusChip";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, useAction } from "@/lib/cockpitApi";
import { cn } from "@/lib/utils";
import type {
  BandPart,
  Part,
  PayEntry,
  PayLineResult,
  PayMonth,
  PayPartResult,
  PayPerson,
  PayPlansList,
} from "@/types/ceo/payPlan";
import { BandRuler } from "./BandRuler";
import { errorText, FIELD, LABEL } from "./fields";
import { type ConfirmRequest, PayConfirmDialog } from "./PayConfirmDialog";
import {
  type EntryTarget,
  PayEntryDialog,
  VoidEntryDialog,
} from "./PayEntryDialog";
import {
  alsoSentence,
  approvable,
  approvePayload,
  baseNote,
  basisWords,
  CONDITIONS_SENTENCE,
  confirmFor,
  dayText,
  driftNote,
  driftSentence,
  hasConditionParts,
  isCashPart,
  isTypedPart,
  lineWorking,
  monthChips,
  monthHeadline,
  monthName,
  nextMonth,
  partChip,
  partNote,
  payUsd,
  payWhen,
  planPartOf,
  planSourceWords,
  statusChip,
  thisMonth,
  valueText,
  whyNotApproved,
} from "./payCopy";

/**
 * Pay for [month] (PAY-PLANS.md 8.5), after On the team: one receipt per
 * person for the month earned, read from the server (cockpit_ceo_pay_month),
 * which works out every amount. A receipt lists the base, each commission
 * line and each part with what it read, where from and its state; a missing
 * input is n/a with its reason and the month reads "at least $X" with A
 * floor, never a smaller number shown as complete. Everything the CEO has to
 * do sits on the receipt it belongs to: add a count, confirm a measure, a
 * close or a setter, apply the role's commission, nothing else for the
 * month, approve, withdraw. An approved person is shown from what was
 * approved, with any change since and the adjustment that carries it.
 */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const numv = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** The Kuwait month of a meeting time, for the close it is confirmed under. */
const meetingMonth = (at: string | null, fallback: string) => {
  if (!at) return fallback;
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return at.slice(0, 7);
  return new Date(ms + 3 * 3600_000).toISOString().slice(0, 7);
};

type Say = (text: string, ok?: boolean) => void;
type Write = (args: Record<string, unknown>) => Promise<unknown>;
type Actions = {
  month: PayMonth;
  /** This Kuwait month, "YYYY-MM": a clawback counts in the month it is found. */
  today: string;
  plans: PayPlansList | null;
  busy: string | null;
  confirm: Write;
  noneRest: Write;
  savePerson: Write;
  onRosterChanged: () => Promise<void> | void;
  run: (key: string, fn: () => Promise<unknown>, said: string) => Promise<void>;
  onEntry: (t: EntryTarget) => void;
  onVoid: (e: PayEntry, label: string) => void;
  onConfirm: (r: ConfirmRequest) => void;
  onWithdraw: (p: PayPerson) => void;
};

export function PayMonthCard({
  plans,
  reloadKey = 0,
  onPlansChanged,
  onRosterChanged,
  onCurrent,
  today = thisMonth(),
  order = 4,
}: {
  plans: PayPlansList | null;
  /** Bumped when a plan or the roster changed elsewhere: the month is read again. */
  reloadKey?: number;
  /** An approval or a withdrawal moves who is approved up to when. */
  onPlansChanged: () => Promise<void> | void;
  /** "Apply the role's commission" changes the roster. */
  onRosterChanged: () => Promise<void> | void;
  /** This month, once read, for the plan sheet's ticks. */
  onCurrent?: (m: PayMonth) => void;
  /** This Kuwait month, "YYYY-MM" (the chips count back from it). */
  today?: string;
  order?: number;
}) {
  const read = useAction(api.ceo.pay.month);
  const confirm = useAction(api.ceo.pay.confirm);
  const noneRest = useAction(api.ceo.pay.noneRest);
  const savePerson = useAction(api.ceo.people.save);
  const chips = monthChips(today);
  const [ym, setYm] = useState(today);
  const [data, setData] = useState<PayMonth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const [refused, setRefused] = useState<{ name: string; sentence: string }[]>(
    [],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [entry, setEntry] = useState<EntryTarget | null>(null);
  const [voiding, setVoiding] = useState<{ e: PayEntry; label: string } | null>(
    null,
  );
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const [approving, setApproving] = useState(false);
  const [withdrawing, setWithdrawing] = useState<PayPerson | null>(null);
  const latest = useRef(ym);
  latest.current = ym;
  const current = useRef(onCurrent);
  current.current = onCurrent;

  const load = useCallback(
    async (m: string) => {
      setLoading(true);
      try {
        const out = (await read({ month: m })) as PayMonth;
        if (latest.current !== m) return;
        setData(out);
        setError(null);
        if (m === today) current.current?.(out);
      } catch (e) {
        if (latest.current === m)
          setError(errorText(e, `Pay for ${monthName(m)} could not be read.`));
      } finally {
        if (latest.current === m) setLoading(false);
      }
    },
    [read, today],
  );
  useEffect(() => {
    setSaid(null);
    setRefused([]);
    void load(ym);
  }, [ym, load]);
  // A plan or a roster line changed elsewhere on the tab: read the month again.
  const seen = useRef(reloadKey);
  useEffect(() => {
    if (seen.current === reloadKey) return;
    seen.current = reloadKey;
    void load(latest.current);
  }, [reloadKey, load]);

  const say: Say = (text, ok = true) => setSaid({ text, ok });
  const refresh = async () => {
    await load(ym);
    await onPlansChanged();
  };
  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    setSaid(null);
    try {
      await fn();
      say(done);
      await refresh();
    } catch (e) {
      say(errorText(e), false);
    } finally {
      setBusy(null);
    }
  };

  const shown = data && data.month.slice(0, 7) === ym ? data : null;
  const ready = approvable(shown);
  const people = shown?.people ?? [];
  const counts = {
    ready: people.filter(p => p.status === "ready").length,
    waiting: people.filter(p => p.status === "waiting").length,
    approved: people.filter(p => p.status === "approved").length,
    open: people.filter(p => p.status === "in_progress").length,
  };
  const headline = shown ? monthHeadline(shown) : null;

  const actions: Actions | null = shown
    ? {
        month: shown,
        today,
        plans,
        busy,
        confirm,
        noneRest,
        savePerson,
        onRosterChanged,
        run,
        onEntry: setEntry,
        onVoid: (e, label) => setVoiding({ e, label }),
        onConfirm: setConfirming,
        onWithdraw: setWithdrawing,
      }
    : null;

  let body: ReactNode;
  if (error && !shown)
    body = (
      <EmptyState
        icon={CircleDashed}
        title={error}
        text="Nothing was changed. Try again; if it keeps failing, the pay figures are not set up on the database yet."
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void load(ym)}
          >
            <RefreshCw aria-hidden /> Try again
          </Button>
        }
        compact
      />
    );
  else if (!shown)
    body = (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {`Working out ${monthName(ym)}`}
      </p>
    );
  else if (!people.length)
    body = (
      <EmptyState
        title={`Nobody has commission or a pay plan for ${monthName(ym)}`}
        text="Give a role a plan in Pay plans above, or a person commission lines in On the team, and their month shows here."
        compact
      />
    );
  else
    body = (
      <div className="grid gap-4">
        <div className="grid gap-1">
          <Facts
            items={[
              ...(headline?.items ?? []),
              { label: "Ready", value: count(counts.ready) },
              { label: "Waiting for you", value: count(counts.waiting) },
              { label: "In progress", value: count(counts.open) },
              { label: "Approved", value: count(counts.approved) },
            ]}
          />
          {/* Said in words, not in a hover: a phone never shows a title. */}
          {headline?.sentence ? (
            <p className="text-xs text-muted-foreground">{headline.sentence}</p>
          ) : null}
        </div>
        <ul className="divide-y border-y">
          {people.map(p => (
            <li key={p.personId}>
              {actions ? <Receipt p={p} a={actions} /> : null}
            </li>
          ))}
        </ul>
        {shown.notOnAPlan.length ? (
          <div className="grid gap-1">
            <span className={KICKER}>Not on a pay plan</span>
            <ul className="grid gap-0.5 text-xs text-muted-foreground">
              {shown.notOnAPlan.map(n => (
                <li
                  key={n.personId}
                >{`${n.name}${n.role ? `, ${n.role}` : ""}: ${n.why}`}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <WhereFrom month={shown} />
      </div>
    );

  return (
    <SectionCard
      id="team-pay-month"
      title={`Pay for ${monthName(ym)}`}
      description={
        shown
          ? [
              ...shown.notes,
              ...(shown.closed || shown.notes.some(n => n.startsWith("Approve"))
                ? []
                : [
                    `Approve ${monthName(ym)} from ${shortDate(shown.settleDay)}.`,
                  ]),
            ].join(" ")
          : payWhen(ym)
      }
      order={order}
      actions={
        <Button
          type="button"
          size="sm"
          disabled={!shown?.closed || ready.length === 0 || busy !== null}
          onClick={() => setApproving(true)}
          title={
            shown && !shown.closed
              ? `Approve ${monthName(ym)} from ${shortDate(shown.settleDay)}.`
              : ready.length === 0
                ? "Nobody is ready to approve."
                : undefined
          }
        >
          <Check aria-hidden />
          {`Approve ${monthName(ym)}`}
        </Button>
      }
    >
      {() => (
        <div className="grid gap-4">
          <FilterChips
            options={chips.map(m => ({ key: m, label: monthName(m) }))}
            value={ym}
            onChange={m => setYm(m)}
            ariaLabel="Which month"
          />
          {said ? (
            <p
              aria-live="polite"
              className={cn(
                "text-sm",
                said.ok
                  ? "text-muted-foreground"
                  : "text-[var(--ceo-critical)]",
              )}
            >
              {said.text}
            </p>
          ) : null}
          {refused.length ? (
            <ul className="grid gap-1 text-sm text-[var(--ceo-critical)]">
              {refused.map(r => (
                <li key={r.name}>{`${r.name}: ${r.sentence}`}</li>
              ))}
            </ul>
          ) : null}
          {error && shown ? (
            <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
          ) : null}
          <div
            aria-busy={loading}
            className={
              loading && shown ? "opacity-60 transition-opacity" : undefined
            }
          >
            {body}
          </div>

          <PayEntryDialog
            target={entry}
            onClose={() => setEntry(null)}
            onDone={async text => {
              say(text);
              await refresh();
            }}
          />
          <VoidEntryDialog
            entry={voiding?.e ?? null}
            label={voiding?.label ?? "the"}
            onClose={() => setVoiding(null)}
            onDone={async text => {
              say(text);
              await refresh();
            }}
          />
          <PayConfirmDialog
            request={confirming}
            onClose={() => setConfirming(null)}
            onDone={async text => {
              say(text);
              await refresh();
            }}
          />
          {shown ? (
            <ApproveDialog
              open={approving}
              month={shown}
              people={ready}
              leftOut={shown.people.flatMap(p => {
                const why = whyNotApproved(p);
                return why ? [{ name: p.name, why }] : [];
              })}
              onClose={() => setApproving(false)}
              onDone={async (text, no) => {
                say(text);
                setRefused(no);
                await refresh();
              }}
            />
          ) : null}
          {shown ? (
            <WithdrawDialog
              person={withdrawing}
              month={shown.month.slice(0, 7)}
              onClose={() => setWithdrawing(null)}
              onDone={async text => {
                say(text);
                await refresh();
              }}
            />
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// One person's receipt

function Line({
  label,
  note,
  value,
  strong,
  children,
}: {
  label: ReactNode;
  note?: ReactNode;
  value: ReactNode;
  strong?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 py-2",
        strong && "border-t pt-3 font-semibold",
      )}
    >
      <dt className="min-w-0 text-sm">
        {label}
        {note ? (
          <span className="mt-0.5 block text-xs font-normal leading-5 text-muted-foreground">
            {note}
          </span>
        ) : null}
      </dt>
      <dd className="text-right font-mono text-sm font-medium tabular-nums">
        {value}
      </dd>
      {children ? <dd className="col-span-2 min-w-0">{children}</dd> : null}
    </div>
  );
}

/** A small action on a receipt; 40px on a touch screen like every button. */
function Act({
  children,
  onClick,
  busy,
  variant = "outline",
}: {
  children: ReactNode;
  onClick: () => void;
  busy?: boolean;
  variant?: "outline" | "ghost" | "default";
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      disabled={busy}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** Does this receipt need the CEO: open it by default. */
const needsYou = (p: PayPerson) =>
  p.status === "waiting" ||
  p.missing.length > 0 ||
  (p.sinceApproval !== null && p.sinceApproval.deltaUsd !== 0) ||
  p.roleCommission?.matches === false;

function Receipt({ p, a }: { p: PayPerson; a: Actions }) {
  const ym = a.month.month.slice(0, 7);
  const chip = statusChip(p);
  const approved = p.status === "approved";
  const planParts = p.parts.map(x =>
    x.kind === "adjustment" ? null : planPartOf(a.plans, p, x.key),
  );
  const typedMissing = p.parts.filter(
    x => isTypedPart(x) && x.state === "missing",
  ).length;
  const totalText =
    p.totalUsd !== null
      ? payUsd(p.totalUsd)
      : `at least ${payUsd(p.lowestUsd)}`;
  const key = (s: string) => `${p.personId}:${s}`;
  // What is still open, without the role-commission sentence said in its own box.
  const open = p.missing.filter(
    m =>
      !(
        p.roleCommission &&
        !p.roleCommission.matches &&
        m === p.roleCommission.sentence
      ),
  );

  return (
    <details className="group" open={needsYou(p)}>
      <summary className="no-marker grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="mt-0.5 size-4 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        <span className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <span className="min-w-0">
            <span className="font-medium">{p.name}</span>
            <span className="block text-xs text-muted-foreground">
              {[
                p.role ?? "No role",
                p.plan.source === "none" && p.commission.length
                  ? "Commission lines, no pay plan"
                  : planSourceWords(p.plan),
              ].join(" · ")}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip tone={chip.tone} label={chip.label} />
            {p.totalUsd === null ? (
              <StatusChip tone="warning" label="A floor" />
            ) : null}
            <span className="font-mono text-sm font-semibold tabular-nums">
              {totalText}
            </span>
          </span>
        </span>
      </summary>

      <div className="grid gap-3 pb-4 pl-6">
        {approved && p.approval ? (
          <p className="text-xs text-muted-foreground">
            {`Approved ${shortDate(p.approval.approvedAt.slice(0, 10))} by the CEO at ${payUsd(p.approval.totalUsd)}. These are the figures approved.`}
          </p>
        ) : null}
        {approved && p.sinceApproval && p.sinceApproval.deltaUsd !== 0 ? (
          <div className="ceo-stale flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 basis-64">
              {driftSentence(p.sinceApproval)}
            </span>
            {/* Nothing to carry while a figure is unread: the change is not known. */}
            {p.sinceApproval.deltaUsd === null ? null : (
              <Act
                busy={a.busy !== null}
                onClick={() =>
                  a.onEntry({
                    person: { personId: p.personId, name: p.name },
                    month: nextMonth(ym),
                    part: "adjustment",
                    preset: {
                      amountUsd: p.sinceApproval?.deltaUsd ?? 0,
                      note: p.sinceApproval
                        ? driftNote(p.sinceApproval, ym)
                        : "",
                      fromMonth: ym,
                    },
                  })
                }
              >
                <Plus aria-hidden />
                {`Add to ${monthName(nextMonth(ym))}`}
              </Act>
            )}
          </div>
        ) : null}

        <dl className="divide-y">
          <Line
            label="Base"
            note={baseNote(p.base)}
            value={
              p.base.usd === null ? (
                <Na hint={p.base.note} />
              ) : (
                payUsd(p.base.usd)
              )
            }
          />
          {p.commission.map(line => (
            <CommissionLineRow
              key={`line-${line.line}`}
              p={p}
              line={line}
              a={a}
              approved={approved}
            />
          ))}
          {p.parts.map((part, i) => (
            <PartRow
              key={`part-${part.key}`}
              p={p}
              part={part}
              planPart={planParts[i]}
              a={a}
              approved={approved}
            />
          ))}
          <Line
            strong
            label={
              <span className="flex flex-wrap items-center gap-2">
                {a.month.closed ? monthName(ym) : `${monthName(ym)} so far`}
              </span>
            }
            note={
              p.totalUsd === null
                ? p.lowestUsd < p.knownUsd
                  ? `${payUsd(p.knownUsd)} known. The least it can come to is ${payUsd(p.lowestUsd)}, every open part at its worst.`
                  : `${payUsd(p.knownUsd)} known so far; what is still open is not in it yet.`
                : payWhen(ym)
            }
            value={totalText}
          />
        </dl>

        {p.entries.length ? (
          <div className="grid gap-1">
            <span className={KICKER}>Typed this month</span>
            <ul className="grid gap-1 text-xs">
              {p.entries.map(e => {
                const label =
                  e.partKey === "adjustment"
                    ? "Adjustment"
                    : (p.parts.find(x => x.key === e.partKey)?.label ??
                      e.partKey);
                const figure =
                  e.amountUsd !== null
                    ? payUsd(e.amountUsd)
                    : e.cashUsd !== null
                      ? `${payUsd(e.cashUsd)} cash`
                      : `${e.quantity ?? 0}`;
                const bits = [
                  e.client,
                  e.product,
                  e.clearedOn ? `cleared ${dayText(e.clearedOn)}` : null,
                  e.postedOn ? `posted ${dayText(e.postedOn)}` : null,
                  e.engagementMonth ? `month ${e.engagementMonth}` : null,
                  e.evidenceRef,
                  e.fromMonth ? `corrects ${monthName(e.fromMonth)}` : null,
                  e.note,
                ].filter(Boolean);
                return (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{`${label}: ${figure}`}</span>
                      {bits.length ? (
                        <span className="text-muted-foreground">{` · ${bits.join(" · ")}`}</span>
                      ) : null}
                    </span>
                    {approved ? null : (
                      <button
                        type="button"
                        onClick={() => a.onVoid(e, label)}
                        className="rounded-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-10"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {p.reviewsToCheck.length && !approved ? (
          <div className="grid gap-1.5">
            <span className={KICKER}>Reviews to check</span>
            {p.reviewsToCheck.map(r => {
              const part = p.parts.find(x =>
                p.entries.some(e => e.id === r.entryId && e.partKey === x.key),
              );
              const planPart = part ? planPartOf(a.plans, p, part.key) : null;
              const amount =
                planPart?.kind === "per_event" ? planPart.amount : null;
              return (
                <div
                  key={r.entryId}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <span className="min-w-0">
                    {`Google review posted ${dayText(r.postedOn)}: check by ${dayText(r.checkBy)} that it is still up.`}
                    {r.due ? (
                      <StatusChip
                        tone="warning"
                        label="Check now"
                        className="ml-2"
                      />
                    ) : null}
                  </span>
                  {planPart ? (
                    <Act
                      onClick={() =>
                        a.onEntry({
                          person: { personId: p.personId, name: p.name },
                          month: a.today,
                          part: planPart,
                          preset: {
                            quantity: -1,
                            note: `Google review taken down within 30 days (posted ${dayText(r.postedOn)})`,
                          },
                        })
                      }
                    >
                      <Undo2 aria-hidden />
                      {`Taken down: claw back ${amount === null ? "it" : payUsd(amount)}`}
                    </Act>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {p.roleCommission && p.roleCommission.matches === false && !approved ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 basis-64">
              {p.roleCommission.sentence}
            </span>
            <Act
              busy={a.busy !== null}
              onClick={() => {
                const rc = p.roleCommission;
                if (!rc || rc.matches) return;
                const [l1, l2] = rc.lines;
                void a.run(
                  key("role-commission"),
                  async () => {
                    await a.savePerson({
                      id: p.personId,
                      commissionBasis: l1?.basis ?? "none",
                      commissionRate: l1?.rate ?? null,
                      commission2Basis: l2?.basis ?? "none",
                      commission2Rate: l2?.rate ?? null,
                    });
                    await a.onRosterChanged();
                  },
                  `${p.name} now has the ${p.plan.role ?? "role"} plan's commission.`,
                );
              }}
            >
              Apply the role's commission
            </Act>
          </div>
        ) : null}

        {open.length && !approved ? (
          <ul className="grid gap-1">
            {open.map(m => (
              <li
                key={m}
                className="flex items-start gap-2 text-xs text-muted-foreground"
              >
                <TriangleAlert
                  className="mt-0.5 size-3.5 shrink-0"
                  style={{ color: "var(--ceo-warning)" }}
                  aria-label="Open"
                />
                <span className="min-w-0">{m}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {p.notPriced.length ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {`Not worked out here: ${p.notPriced.map(basisWords).join(", ")}. Costs projects them from next month's plan; they are not in this total.`}
            </span>
          </p>
        ) : null}
        {p.note ? (
          <p className="text-xs text-muted-foreground">{p.note}</p>
        ) : null}
        {hasConditionParts(planParts) ? (
          <p className="text-xs text-muted-foreground">{CONDITIONS_SENTENCE}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {typedMissing && !approved ? (
            <Act
              busy={a.busy !== null}
              onClick={() =>
                void a.run(
                  key("none-rest"),
                  () => a.noneRest({ personId: p.personId, month: ym }),
                  `Nothing else for ${p.name} in ${monthName(ym)}: ${plural(typedMissing, "count")} set to none.`,
                )
              }
            >
              {`Nothing else for ${monthName(ym)}`}
            </Act>
          ) : null}
          {approved ? (
            <Act variant="ghost" onClick={() => a.onWithdraw(p)}>
              Withdraw
            </Act>
          ) : (
            <Act
              variant="ghost"
              onClick={() =>
                a.onEntry({
                  person: { personId: p.personId, name: p.name },
                  month: ym,
                  part: "adjustment",
                })
              }
            >
              <Plus aria-hidden /> Add an adjustment
            </Act>
          )}
        </div>
      </div>
    </details>
  );
}

function CommissionLineRow({
  p,
  line,
  a,
  approved,
}: {
  p: PayPerson;
  line: PayLineResult;
  a: Actions;
  approved: boolean;
}) {
  const ym = a.month.month.slice(0, 7);
  const working = lineWorking(line);
  const waiting = arr(line.waiting).map(obj);
  const value =
    line.state === "not_here" ? (
      <span className="text-xs font-normal text-muted-foreground">
        not here
      </span>
    ) : line.amountUsd === null ? (
      <Na hint={line.note} />
    ) : (
      payUsd(line.amountUsd)
    );
  return (
    <Line
      label={
        <span className="flex flex-wrap items-center gap-2">
          {basisWords(line.basis)}
          {line.state === "waiting" ? (
            <StatusChip tone="warning" label="Waiting for you" />
          ) : null}
        </span>
      }
      note={[working, line.note].filter(Boolean).join(" · ")}
      value={
        line.state === "waiting" && line.amountUsd !== null ? (
          <span>
            {payUsd(line.amountUsd)}
            <span className="block text-[11px] font-normal text-muted-foreground">
              so far
            </span>
          </span>
        ) : (
          value
        )
      }
    >
      {waiting.length && !approved ? (
        <ul className="grid gap-2">
          {waiting.map((w, i) =>
            str(w.appointmentId) ? (
              <CloseItem
                key={str(w.appointmentId) ?? i}
                w={w}
                ym={ym}
                p={p}
                a={a}
              />
            ) : str(w.responseId) ? (
              <SetterItem
                key={str(w.responseId) ?? i}
                w={w}
                ym={ym}
                p={p}
                a={a}
              />
            ) : null,
          )}
        </ul>
      ) : null}
    </Line>
  );
}

/** A close seen only on a client sheet: confirm it or say it was not one. */
function CloseItem({
  w,
  ym,
  p,
  a,
}: {
  w: Obj;
  ym: string;
  p: PayPerson;
  a: Actions;
}) {
  const id = str(w.appointmentId) ?? "";
  const at = str(w.meetingAt);
  const month = meetingMonth(at, ym);
  const send = (confirmed: boolean) =>
    void a.run(
      `${p.personId}:close:${id}`,
      () =>
        a.confirm({
          month,
          key: `close:${id}`,
          value: { confirmed },
        }),
      confirmed
        ? `Confirmed the close for ${str(w.client) ?? "the client"}.`
        : `Marked not a close: ${str(w.client) ?? "the client"}.`,
    );
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
      <span className="min-w-0">
        {`${str(w.client) ?? "A client"} · meeting ${at ? dayText(at) : "n/a"} · seen on the client's sheet only`}
      </span>
      <span className="flex gap-2">
        <Act busy={a.busy !== null} onClick={() => send(true)}>
          Confirm close
        </Act>
        <Act busy={a.busy !== null} variant="ghost" onClick={() => send(false)}>
          Not a close
        </Act>
      </span>
    </li>
  );
}

/** A deal whose setter the sources disagree on: pick who set it. */
function SetterItem({
  w,
  ym,
  p,
  a,
}: {
  w: Obj;
  ym: string;
  p: PayPerson;
  a: Actions;
}) {
  const id = str(w.responseId) ?? "";
  const people = (a.plans?.people ?? []).filter(x => x.active);
  const intro = str(w.intro);
  const guess = people.find(x => x.name === intro)?.id ?? null;
  const [pick, setPick] = useState<string>(guess === null ? "" : String(guess));
  return (
    <li className="grid gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
      <span className="min-w-0">
        {str(w.state) === "none" || (!str(w.form) && !intro)
          ? `${str(w.business) ?? "A deal"}: neither the closer form nor an intro before signing names a setter. Choose who set it, or Nobody on the team.`
          : `${str(w.business) ?? "A deal"}: the closer form says ${str(w.form) ?? "nobody"}, the last intro before signing says ${intro ?? "nobody"}.`}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <AnimatedSelect
          value={pick}
          onChange={e => setPick(e.target.value)}
          aria-label={`Who set ${str(w.business) ?? "the deal"}`}
          className="ceo-select-sm min-w-0 max-w-full"
        >
          <option value="">Choose who set it</option>
          {people.map(x => (
            <option key={x.id} value={String(x.id)}>
              {x.name}
            </option>
          ))}
          <option value="none">Nobody on the team</option>
        </AnimatedSelect>
        <Act
          busy={a.busy !== null || pick === ""}
          onClick={() =>
            void a.run(
              `${p.personId}:setter:${id}`,
              () =>
                a.confirm({
                  month: ym,
                  key: `setter:${id}`,
                  value: { personId: pick === "none" ? null : Number(pick) },
                }),
              `Confirmed who set ${str(w.business) ?? "the deal"}.`,
            )
          }
        >
          Confirm setter
        </Act>
      </span>
    </li>
  );
}

function PartRow({
  p,
  part,
  planPart,
  a,
  approved,
}: {
  p: PayPerson;
  part: PayPartResult;
  planPart: Part | null;
  a: Actions;
  approved: boolean;
}) {
  const ym = a.month.month.slice(0, 7);
  const chip = partChip(part);
  const input = part.input;
  const target = confirmFor(part, p.personId, ym, planPart);
  const typed = isTypedPart(part);
  const out = arr(input?.out).map(obj);
  const pifWaiting = arr(input?.waiting)
    .map(obj)
    .filter(w => str(w.responseId));
  const value =
    part.state === "missing" || part.amountUsd === null ? (
      <Na
        hint={
          input?.note ??
          (isCashPart(part)
            ? "Waiting for the month's cash."
            : "Waiting for a count or a confirmation.")
        }
      />
    ) : (
      payUsd(part.amountUsd)
    );
  const bandPart: BandPart | null = planPart?.kind === "band" ? planPart : null;
  // A stored confirmation: "Change" starts from it, and it can be removed.
  const stored =
    input?.confirmed !== undefined && input?.confirmed !== null
      ? input.confirmed
      : input?.state === "confirmed" && target?.kind === "qualifying"
        ? { count: input.value }
        : null;
  const also = input?.alsoTracked ?? null;
  return (
    <Line
      label={
        <span className="flex flex-wrap items-center gap-2">
          {part.label}
          {chip ? <StatusChip tone={chip.tone} label={chip.label} /> : null}
        </span>
      }
      note={partNote(part)}
      value={value}
    >
      {bandPart && input?.value !== null && input?.value !== undefined ? (
        <BandRuler
          part={bandPart}
          marks={[{ value: input.value, label: monthName(ym).slice(0, 3) }]}
          className="max-w-xl"
        />
      ) : null}
      {out.length ? (
        <p className="text-xs text-muted-foreground">
          {`Left out: ${out.map(o => `${str(o.name) ?? str(o.clickupId) ?? "a client"} (${str(o.why) ?? "no reason given"})`).join("; ")}.`}
        </p>
      ) : null}
      {input?.nonLeadSpendUsd ? (
        <p className="text-xs text-muted-foreground">
          {`${money(input.nonLeadSpendUsd)} was spent outside lead campaigns and is not in the cost per lead.`}
        </p>
      ) : null}
      {also ? (
        <p className="text-xs text-muted-foreground">
          {alsoSentence({
            metric: also.metric,
            month: ym,
            over: also.over === "same" ? "same" : "every_client",
            values: [{ who: null, value: also.value, note: also.note }],
          })}
        </p>
      ) : null}
      {!approved && (typed || target || pifWaiting.length) ? (
        <div className="flex flex-wrap items-center gap-2">
          {typed && planPart ? (
            <Act
              busy={a.busy !== null}
              onClick={() =>
                a.onEntry({
                  person: { personId: p.personId, name: p.name },
                  month: ym,
                  part: planPart,
                })
              }
            >
              <Plus aria-hidden />
              {planPart.kind === "share" ? "Add cash" : "Add a count"}
            </Act>
          ) : null}
          {target ? (
            <Act
              busy={a.busy !== null}
              onClick={() =>
                a.onConfirm({
                  ...target,
                  person: { personId: p.personId, name: p.name },
                  planPart,
                  proposal:
                    input?.proposal ?? proposalFromFacts(a.month, target, p),
                  confirmed:
                    stored !== null ||
                    (target.kind === "ramp" && input?.state === "confirmed"),
                  current: stored,
                  names: clientNames(a.month),
                  start: typeof input?.start === "string" ? input.start : null,
                })
              }
            >
              {stored !== null || input?.state !== "missing"
                ? "Change"
                : "Confirm"}
            </Act>
          ) : null}
          {pifWaiting.map(w => {
            const id = str(w.responseId) ?? "";
            const send = (earned: boolean) =>
              void a.run(
                `${p.personId}:pif:${id}`,
                () =>
                  a.confirm({
                    month: ym,
                    key: `pif:${id}`,
                    value: { earned },
                  }),
                earned
                  ? `Paid in full: ${str(w.business) ?? "the deal"}.`
                  : `Not paid in full yet: ${str(w.business) ?? "the deal"}.`,
              );
            return (
              <span
                key={id}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <span>{`${str(w.business) ?? "A deal"}${numv(w.shortUsd) !== null ? `, ${payUsd(numv(w.shortUsd))} short of its contract` : ""}:`}</span>
                <Act busy={a.busy !== null} onClick={() => send(true)}>
                  Paid in full
                </Act>
                <Act
                  busy={a.busy !== null}
                  variant="ghost"
                  onClick={() => send(false)}
                >
                  Not yet
                </Act>
              </span>
            );
          })}
        </div>
      ) : null}
    </Line>
  );
}

/** The proposal a confirmation starts from when the part carries none: the month's own facts. */
function proposalFromFacts(
  m: PayMonth,
  target: NonNullable<ReturnType<typeof confirmFor>>,
  p: PayPerson,
): unknown {
  const facts = obj(m.facts);
  if (target.kind === "owned")
    return arr(obj(facts.clients).ownedCreative)
      .map(obj)
      .find(o => o.personId === p.personId);
  if (target.kind === "churn")
    return target.key === "logo_churn"
      ? obj(obj(facts.clientsPrior).logo)
      : arr(obj(facts.clients).byCsm)
          .map(obj)
          .find(o => o.personId === p.personId);
  if (target.kind === "qualifying")
    return obj(
      arr(obj(facts.clients).byCsm)
        .map(obj)
        .find(o => o.personId === p.personId)?.qualifying,
    );
  return null;
}

/** Each client's name by ClickUp id, from the month's facts: a confirmation stores ids only. */
function clientNames(m: PayMonth): Record<string, string> {
  const facts = obj(m.facts);
  const out: Record<string, string> = {};
  const add = (v: unknown) => {
    const c = obj(v);
    const id = str(c.clickupId);
    const name = str(c.name);
    if (id && name && !out[id]) out[id] = name;
  };
  arr(obj(facts.ads).clients).forEach(add);
  for (const o of arr(obj(facts.clients).ownedCreative).map(obj)) {
    arr(o.clients).forEach(add);
    arr(o.others).forEach(add);
  }
  for (const b of arr(obj(facts.clients).byCsm).map(obj)) {
    arr(b.lost).forEach(add);
    arr(b.candidates).forEach(add);
  }
  arr(obj(obj(facts.clientsPrior).logo).lost).forEach(add);
  arr(obj(obj(facts.clientsPrior).logo).candidates).forEach(add);
  return out;
}

// ---------------------------------------------------------------------------
// Approve and withdraw

function ApproveDialog({
  open,
  month,
  people,
  leftOut,
  onClose,
  onDone,
}: {
  open: boolean;
  month: PayMonth;
  people: PayPerson[];
  /** Everyone not in this approval, and why. */
  leftOut: { name: string; why: string }[];
  onClose: () => void;
  onDone: (
    said: string,
    refused: { name: string; sentence: string }[],
  ) => Promise<void> | void;
}) {
  const approve = useAction(api.ceo.pay.approve);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ym = month.month.slice(0, 7);
  const total = people.reduce((s, p) => s + (p.totalUsd ?? 0), 0);
  return (
    <Dialog open={open} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent className="ceo-root max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle>{`Approve ${monthName(ym)}`}</DialogTitle>
          <DialogDescription>
            {`${payWhen(ym)} Each total is sent as you see it; if a figure moved since, that person is refused and the rest are approved.`}
          </DialogDescription>
        </DialogHeader>
        <dl className="divide-y text-sm">
          {people.map(p => (
            <div
              key={p.personId}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-1.5"
            >
              <dt className="min-w-0">{p.name}</dt>
              <dd className="font-mono tabular-nums">{payUsd(p.totalUsd)}</dd>
            </div>
          ))}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 pt-2 font-semibold">
            <dt>{plural(people.length, "person", "people")}</dt>
            <dd className="font-mono tabular-nums">{payUsd(total)}</dd>
          </div>
        </dl>
        {leftOut.length ? (
          <div className="grid gap-1">
            <span className={KICKER}>Not in this approval</span>
            <ul className="grid gap-0.5 text-xs text-muted-foreground">
              {leftOut.map(x => (
                <li key={x.name}>{`${x.name}: ${x.why}.`}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {msg ? (
          <p role="alert" className="text-sm text-[var(--ceo-critical)]">
            {msg}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || people.length === 0}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                const out = (await approve(approvePayload(month, people))) as {
                  approved: number;
                  existing: number;
                  refused: { personId: number; sentence: string }[];
                };
                const name = (id: number) =>
                  month.people.find(x => x.personId === id)?.name ??
                  `Person ${id}`;
                onClose();
                await onDone(
                  [
                    `Approved ${monthName(ym)} for ${plural(out.approved, "person", "people")}.`,
                    out.existing
                      ? `${count(out.existing)} ${out.existing === 1 ? "was" : "were"} already approved.`
                      : null,
                    out.refused.length
                      ? `${plural(out.refused.length, "person", "people")} refused:`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" "),
                  out.refused.map(r => ({
                    name: name(r.personId),
                    sentence: r.sentence,
                  })),
                );
              } catch (e) {
                setMsg(errorText(e, "Nothing was approved."));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Check aria-hidden />
            )}
            {`Approve ${monthName(ym)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawDialog({
  person,
  month,
  onClose,
  onDone,
}: {
  person: PayPerson | null;
  month: string;
  onClose: () => void;
  onDone: (said: string) => Promise<void> | void;
}) {
  const withdraw = useAction(api.ceo.pay.withdraw);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Dialog
      open={person !== null}
      onOpenChange={o => {
        if (!o) {
          setWhy("");
          setMsg(null);
          onClose();
        }
      }}
    >
      <DialogContent className="ceo-root sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={async e => {
            e.preventDefault();
            if (!person) return;
            if (why.trim().length < 3) {
              setMsg("Say why, in a few words.");
              return;
            }
            setBusy(true);
            setMsg(null);
            try {
              await withdraw({
                personId: person.personId,
                month,
                reason: why.trim(),
              });
              setWhy("");
              onClose();
              await onDone(
                `Withdrew ${monthName(month)} for ${person.name}. Their month is worked out again and can be approved once ready.`,
              );
            } catch (err) {
              setMsg(errorText(err, "The approval was not withdrawn."));
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader className="pr-8">
            <DialogTitle>
              {person ? `Withdraw ${monthName(month)} for ${person.name}` : ""}
            </DialogTitle>
            <DialogDescription>
              The approval is kept, marked withdrawn with your reason, and the
              month is worked out from today's figures.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1">
            <span className={LABEL}>Why</span>
            <input
              value={why}
              onChange={e => setWhy(e.target.value)}
              placeholder="A close was confirmed after approval"
              className={cn(FIELD, "w-full")}
              maxLength={300}
            />
          </label>
          {msg ? (
            <p role="alert" className="text-sm text-[var(--ceo-critical)]">
              {msg}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Withdraw
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Where these numbers come from

function WhereFrom({ month }: { month: PayMonth }) {
  const facts = obj(month.facts);
  const errors = obj(facts.errors);
  const ads = obj(facts.ads);
  const calls = obj(facts.calls);
  const clients = obj(facts.clients);
  const sales = obj(facts.sales);
  const nothing =
    !arr(ads.clients).length &&
    !arr(calls.agents).length &&
    !Object.keys(obj(clients.logo)).length &&
    !arr(sales.deals).length;
  return (
    <details className="border-t pt-3">
      <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
        Where these numbers come from
      </summary>
      <div className="mt-3 grid gap-5">
        {Object.entries(errors).map(([k, v]) => (
          <p
            key={k}
            className="flex items-start gap-2 text-xs text-muted-foreground"
          >
            <TriangleAlert
              className="mt-0.5 size-3.5 shrink-0"
              style={{ color: "var(--ceo-warning)" }}
              aria-label="Warning"
            />
            <span>{`The ${k} figures could not be read: ${String(v)}`}</span>
          </p>
        ))}
        {nothing ? (
          <p className="text-xs text-muted-foreground">
            {`Nothing was read for ${monthName(month.month)}: no ads, calls, client or deal figures.`}
          </p>
        ) : null}
        {arr(ads.clients).length || notesOf(ads.note).length ? (
          <AdsFacts ads={ads} />
        ) : null}
        {arr(calls.agents).length ? <CallsFacts calls={calls} /> : null}
        {Object.keys(obj(clients.logo)).length ||
        notesOf(clients.note).length ? (
          <ChurnFacts clients={clients} />
        ) : null}
        {arr(sales.deals).length ||
        notesOf(sales.note).length ||
        arr(sales.unkeyed).length ? (
          <SalesFacts sales={sales} />
        ) : null}
      </div>
    </details>
  );
}

/** A facts note: a list of sentences (an older payload sent one string). */
function notesOf(v: unknown): string[] {
  if (typeof v === "string") return v.trim() ? [v] : [];
  return arr(v).filter((x): x is string => typeof x === "string" && !!x.trim());
}

/** What a source says it read and what it leaves out, under its table. */
function FactNotes({ note }: { note: unknown }) {
  const said = notesOf(note);
  if (!said.length) return null;
  return (
    <ul className="grid list-disc gap-0.5 pl-4 text-xs text-muted-foreground">
      {said.map(n => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

const TH = "py-1.5 pr-3 text-left font-medium";
const TD = "whitespace-nowrap py-1.5 pr-3 align-top";

function Scroll({ children, min }: { children: ReactNode; min: string }) {
  return (
    <div className="ceo-table-scroll relative -mx-1 overflow-x-auto px-1">
      <table className={cn("w-full text-xs tabular-nums", min)}>
        {children}
      </table>
    </div>
  );
}

function AdsFacts({ ads }: { ads: Obj }) {
  const pooled = obj(ads.pooled);
  return (
    <section className="grid gap-2">
      <span className={KICKER}>Ads, per client</span>
      {arr(ads.clients).length ? (
        <>
          <p className="text-xs text-muted-foreground">
            {`Pooled over ${count(numv(pooled.clients))} clients: cost per lead ${valueText(numv(pooled.cpl), "usd")} (${count(numv(pooled.leads))} leads on ${money(numv(pooled.leadSpendUsd))} of lead-campaign spend), cost per booking ${valueText(numv(pooled.cpb), "usd")} (${count(numv(pooled.bookings))} bookings over ${count(numv(pooled.cpbClients))} clients). ${money(numv(pooled.nonLeadSpendUsd))} spent outside lead campaigns.${str(ads.adThrough) ? ` Meta read to ${dayText(str(ads.adThrough))}.` : ""}`}
          </p>
          <Scroll min="min-w-[560px]">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className={TH}>Client</th>
                <th className={cn(TH, "text-right")}>Cost per lead</th>
                <th className={cn(TH, "text-right")}>Cost per booking</th>
                <th className={cn(TH, "text-right")}>Outside lead campaigns</th>
                <th className={TH}>Left out</th>
              </tr>
            </thead>
            <tbody>
              {arr(ads.clients)
                .map(obj)
                .map(c => {
                  const nm = obj(c.notMeasured);
                  const why = [str(nm.cpl), str(nm.cpb)]
                    .filter(Boolean)
                    .join("; ");
                  return (
                    <tr
                      key={str(c.clickupId) ?? str(c.name) ?? ""}
                      className="border-b last:border-b-0"
                    >
                      <td className={TD}>{str(c.name) ?? "n/a"}</td>
                      <td className={cn(TD, "text-right")}>
                        {valueText(numv(c.cpl), "usd")}
                      </td>
                      <td className={cn(TD, "text-right")}>
                        {valueText(numv(c.cpb), "usd")}
                      </td>
                      <td className={cn(TD, "text-right")}>
                        {money(numv(c.nonLeadSpendUsd))}
                      </td>
                      <td className={cn(TD, "text-muted-foreground")}>
                        {why || ""}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </Scroll>
        </>
      ) : null}
      <FactNotes note={ads.note} />
    </section>
  );
}

function CallsFacts({ calls }: { calls: Obj }) {
  const score = new Map(
    arr(obj(calls.scorecard).callers)
      .map(obj)
      .map(c => [str(c.email) ?? str(c.name) ?? "", c]),
  );
  const un = obj(calls.unattributed);
  return (
    <section className="grid gap-2">
      <span className={KICKER}>Call centre, per agent</span>
      <Scroll min="min-w-[620px]">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className={TH}>Agent</th>
            <th className={cn(TH, "text-right")}>Shows</th>
            <th className={TH}>By</th>
            <th className={cn(TH, "text-right")}>No-shows</th>
            <th className={cn(TH, "text-right")}>Not marked</th>
            <th className={cn(TH, "text-right")}>Closes</th>
            <th className={TH}>Shared report (not paid on)</th>
          </tr>
        </thead>
        <tbody>
          {arr(calls.agents)
            .map(obj)
            .map(g => {
              const by = obj(g.showsBy);
              const s =
                score.get(str(g.email) ?? "") ?? score.get(str(g.name) ?? "");
              return (
                <tr
                  key={str(g.email) ?? str(g.name) ?? ""}
                  className="border-b last:border-b-0"
                >
                  <td className={TD}>{str(g.name) ?? str(g.email) ?? "n/a"}</td>
                  <td className={cn(TD, "text-right")}>
                    {count(numv(g.shows))}
                  </td>
                  <td className={cn(TD, "text-muted-foreground")}>
                    {`dialer ${count(numv(by.console))} · central ${count(numv(by.central))} · sheet ${count(numv(by.sheet))}`}
                  </td>
                  <td className={cn(TD, "text-right")}>
                    {count(numv(g.noShows))}
                  </td>
                  <td className={cn(TD, "text-right")}>
                    {count(numv(g.unmarked))}
                  </td>
                  <td className={cn(TD, "text-right")}>
                    {count(arr(g.closes).length)}
                  </td>
                  <td className={cn(TD, "text-muted-foreground")}>
                    {s
                      ? `${count(numv(s.shows))} shows, ${count(numv(s.closed))} closed`
                      : "not on it"}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </Scroll>
      {arr(un.items).length ? (
        <p className="text-xs text-muted-foreground">
          {`Credited to nobody: ${arr(un.items)
            .map(obj)
            .map(
              i =>
                `${str(i.client) ?? "a client"} ${str(i.meetingAt) ? dayText(str(i.meetingAt)) : ""} (${str(i.why) ?? "no reason"})`,
            )
            .join("; ")}.`}
        </p>
      ) : null}
      {str(calls.scorecardNote) ? (
        <p className="text-xs text-muted-foreground">
          {str(calls.scorecardNote)}
        </p>
      ) : null}
    </section>
  );
}

function ChurnFacts({ clients }: { clients: Obj }) {
  const logo = obj(clients.logo);
  const prop = obj(logo.proposal);
  const lost = arr(logo.lost).map(obj);
  const cands = arr(logo.candidates).map(obj);
  return (
    <section className="grid gap-2">
      <span className={KICKER}>Churn</span>
      {Object.keys(logo).length ? (
        <p className="text-xs text-muted-foreground">
          {`Company: ${count(numv(prop.lost))} of ${count(numv(prop.activeAtStart))} clients at the start lost (${valueText(numv(prop.pct), "pct")}), as the data proposes it.`}
        </p>
      ) : null}
      {lost.length || cands.length ? (
        <ul className="grid gap-0.5 text-xs text-muted-foreground">
          {lost.map(l => (
            <li
              key={str(l.clickupId) ?? ""}
            >{`Lost: ${str(l.name) ?? "a client"}${str(l.why) ? `, ${str(l.why)}` : ""}`}</li>
          ))}
          {cands.map(l => (
            <li
              key={str(l.clickupId) ?? ""}
            >{`Candidate: ${str(l.name) ?? "a client"}${str(l.why) ? `, ${str(l.why)}` : ""}`}</li>
          ))}
        </ul>
      ) : null}
      {arr(clients.byCsm).length ? (
        <ul className="grid gap-0.5 text-xs text-muted-foreground">
          {arr(clients.byCsm)
            .map(obj)
            .map(c => {
              const pp = obj(c.proposal);
              return (
                <li
                  key={str(c.name) ?? String(c.personId)}
                >{`${str(c.name) ?? "No CSM on the card"}: ${count(numv(pp.lost))} of ${count(numv(pp.activeAtStart))} (${valueText(numv(pp.pct), "pct")})`}</li>
              );
            })}
        </ul>
      ) : null}
      <FactNotes note={clients.note} />
    </section>
  );
}

function SalesFacts({ sales }: { sales: Obj }) {
  const deals = arr(sales.deals).map(obj);
  const business = (id: string | null) =>
    str(deals.find(d => str(d.responseId) === id)?.business) ?? id ?? "a deal";
  const unkeyed = arr(sales.unkeyed).map(obj);
  const un = obj(sales.unattributed);
  const unItems = arr(un.items).map(obj);
  return (
    <section className="grid gap-2">
      <span className={KICKER}>Deals and payments</span>
      {deals.length ? (
        <Scroll min="min-w-[640px]">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className={TH}>Deal</th>
              <th className={TH}>Signed</th>
              <th className={cn(TH, "text-right")}>Contract</th>
              <th className={cn(TH, "text-right")}>Cash this month</th>
              <th className={TH}>Closer</th>
              <th className={TH}>Set by</th>
              <th className={TH}>Paid in full</th>
            </tr>
          </thead>
          <tbody>
            {arr(sales.deals)
              .map(obj)
              .map(d => {
                const setter = obj(d.setter);
                const pif = obj(d.pif);
                const pays = arr(d.payments).map(obj);
                return (
                  <tr
                    key={str(d.responseId) ?? ""}
                    className="border-b last:border-b-0"
                  >
                    <td className={cn(TD, "min-w-56 whitespace-normal")}>
                      {str(d.business) ?? "n/a"}
                      {pays.length ? (
                        <span className="block text-muted-foreground">
                          {pays
                            .map(
                              x =>
                                `${str(x.rail) ?? "?"} ${dayText(str(x.day))} ${money(numv(x.usd))} (${str(x.matchedBy) ?? "matched"})`,
                            )
                            .join(" · ")}
                        </span>
                      ) : null}
                    </td>
                    <td className={TD}>{dayText(str(d.signedDay))}</td>
                    <td className={cn(TD, "text-right")}>
                      {money(numv(d.contracted))}
                    </td>
                    <td className={cn(TD, "text-right")}>
                      {money(numv(d.cashInMonth))}
                    </td>
                    <td className={TD}>{str(obj(d.closer).name) ?? "n/a"}</td>
                    <td className={TD}>
                      {str(setter.name) ?? "n/a"}
                      {setter.disagree ? (
                        <span className="block text-muted-foreground">
                          sources disagree
                        </span>
                      ) : null}
                    </td>
                    <td className={TD}>
                      {pif.state === "earned"
                        ? `yes, ${dayText(str(pif.day))}`
                        : pif.state === "waiting"
                          ? "waiting for you"
                          : `no${numv(pif.shortUsd) ? `, ${money(numv(pif.shortUsd))} short` : ""}`}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </Scroll>
      ) : null}
      {str(sales.cashThrough) ? (
        <p className="text-xs text-muted-foreground">{`Cash read to ${dayText(str(sales.cashThrough))}, from every payment rail, tied to its deal.`}</p>
      ) : null}
      {unkeyed.length ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <TriangleAlert
            className="mt-0.5 size-3.5 shrink-0"
            style={{ color: "var(--ceo-warning)" }}
            aria-label="Warning"
          />
          <span>
            {`Names that match nobody on the team list: ${unkeyed
              .map(
                u =>
                  `${str(u.name) ?? "no name"} (${str(u.role) === "closer" ? "closer" : "setter"} on ${business(str(u.responseId))})`,
              )
              .join(
                "; ",
              )}. Their cash is credited to nobody until the name is added to a sales rep's aliases, or the rep's seat email to the roster.`}
          </span>
        </p>
      ) : null}
      {numv(un.count) ? (
        <p className="text-xs text-muted-foreground">
          {`Not tied to a deal, never counted: ${plural(numv(un.count) ?? 0, "payment")}, ${payUsd(numv(un.usd))}${
            unItems.length
              ? ` (${unItems
                  .slice(0, 5)
                  .map(
                    i =>
                      `${str(i.payer) ?? "no payer"} ${payUsd(numv(i.usd))} ${dayText(str(i.day))}`,
                  )
                  .join(
                    "; ",
                  )}${unItems.length > 5 ? `; and ${unItems.length - 5} more` : ""})`
              : ""
          }. Attribute them on the Transactions tab.`}
        </p>
      ) : null}
      <FactNotes note={sales.note} />
    </section>
  );
}
