import { Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { useQuery } from "../lib/data";
import { count, day, money, num } from "../lib/format";
import {
  baseApplies,
  closerNames,
  hasPayRule,
  isTheirDeal,
  payEstimate,
  payWords,
  ratePercent,
  setterEstimate,
} from "../lib/pay";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { Deal, PayRule, Rep, SalesRole, Scorecard } from "../lib/types";
import { button, EmptyState, Failed, SectionCard, StatusChip } from "./kit";

/**
 * The person's pay rule in words and, for a closer, what the window's deals
 * earn under it. Only the rep and the managers ever read a pay rule (row
 * security on cockpit_sales_people); Team total has no Pay card.
 */

type PayDeal = Pick<
  Deal,
  | "response_id"
  | "submitted_at"
  | "closer"
  | "client_name"
  | "business_name"
  | "cash_collected"
  | "contracted_revenue"
>;

export function NumbersPay({
  rule,
  role,
  rep,
  card,
  fromIso,
  toIso,
  fromDay,
  toDay,
  whose,
  manager = false,
}: {
  rule: PayRule | null;
  role: SalesRole | null;
  /** The B2B rep the seat is linked to, whose closer names the deals carry. */
  rep: Rep | null;
  card: Scorecard | null;
  fromIso: string;
  toIso: string;
  /** The window's first and last Kuwait days, for the monthly base. */
  fromDay: string;
  toDay: string;
  whose: "your" | "their";
  /** A manager may say whether a setter's deal fully closed. */
  manager?: boolean;
}) {
  if (!rule || !hasPayRule(rule))
    return (
      <SectionCard title="Pay">
        <EmptyState
          compact
          icon={Wallet}
          title="No pay rule set yet"
          text={
            whose === "your" ? (
              "Aziz sets it on the Team page, as agreed with you."
            ) : (
              <>
                Set it on the{" "}
                <Link to="/team" className="underline underline-offset-2">
                  Team page
                </Link>
                .
              </>
            )
          }
        />
      </SectionCard>
    );

  const words = payWords(rule, whose);
  const setter = role === "setter";
  return (
    <SectionCard
      title="Pay"
      side={setter ? null : <StatusChip tone="neutral" label="Estimate" />}
    >
      <p className="text-sm leading-relaxed">
        {words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}.` : null}
      </p>
      {rule.note ? (
        <p className="muted mt-1 text-xs" dir="auto">
          As agreed: {rule.note}
        </p>
      ) : null}
      {setter ? (
        rep ? (
          <SetterEstimateView
            rule={rule}
            rep={rep}
            fromIso={fromIso}
            toIso={toIso}
            monthBase={baseApplies(fromDay, toDay)}
            whose={whose}
            manager={manager}
          />
        ) : (
          <p className="muted mt-3 text-xs">
            {whose === "your" ? "Your seat is" : "This seat is"} not linked to a
            B2B rep yet, so no intros or deals can be counted.
          </p>
        )
      ) : rep ? (
        <Estimate
          rule={rule}
          rep={rep}
          card={card}
          fromIso={fromIso}
          toIso={toIso}
          whose={whose}
        />
      ) : (
        <p className="muted mt-3 text-xs">
          {whose === "your" ? "Your seat is" : "This seat is"} not linked to a
          B2B rep yet, so no deals can be matched for an estimate.
        </p>
      )}
    </SectionCard>
  );
}

interface SetterDeal {
  response_id: string;
  submitted_at: string;
  closer: string | null;
  client_name: string | null;
  business_name: string | null;
  payment_structure: string | null;
  cash_collected: number | null;
  contracted_revenue: number | null;
  credited_by: "form" | "intro";
  fully_closed: boolean;
  fully_closed_by: "paid in full" | "confirmed" | null;
}

/**
 * A setter's window: the base (for a month), the intros they ran that were
 * marked showed (a showed intro not marked disqualified is a qualified one),
 * and the deals from their leads, each paying once it fully closed.
 */
function SetterEstimateView({
  rule,
  rep,
  fromIso,
  toIso,
  monthBase,
  whose,
  manager,
}: {
  rule: PayRule;
  rep: Rep;
  fromIso: string;
  toIso: string;
  monthBase: boolean;
  whose: "your" | "their";
  manager: boolean;
}) {
  const intros = useQuery<{ status: string | null; needs_mark: boolean }[]>(
    () =>
      supabase
        .from("cockpit_sales_calendar")
        .select("status,needs_mark")
        .eq("call_type", "intro")
        .eq("assigned_user_id", rep.ghl_user_id ?? "__none__")
        .gte("start_at", fromIso)
        .lt("start_at", toIso)
        .limit(2000),
    [rep.ghl_user_id, fromIso, toIso],
  );
  const deals = useQuery<SetterDeal[]>(
    () =>
      supabase.rpc("cockpit_sales_setter_deals", {
        p_rep_id: rep.id,
        p_from: fromIso,
        p_to: toIso,
      }),
    [rep.id, fromIso, toIso],
  );
  const [busy, setBusy] = useState<string | null>(null);

  if (intros.error || deals.error)
    return (
      <div className="mt-3">
        <Failed
          what={intros.error ? "The intros" : "The deals"}
          error={intros.error ?? deals.error ?? "no reason given"}
          retry={() => {
            intros.reload();
            deals.reload();
          }}
        />
      </div>
    );
  if (!intros.data || !deals.data)
    return <p className="muted mt-3 text-sm">Reading the intros and deals…</p>;

  const cur = rule.currency || "USD";
  const qualified = intros.data.filter(i => i.status === "showed").length;
  const unmarked = intros.data.filter(i => i.needs_mark).length;
  const e = setterEstimate(rule, qualified, deals.data, monthBase);
  const base = num(rule.base_monthly);
  const perIntro = num(rule.per_intro_qualified);
  const perClose = num(rule.per_full_close);

  async function decide(id: string, fully: boolean | null) {
    setBusy(id);
    try {
      await api("deal.status", { response_id: id, fully_closed: fully });
      toast.success(
        fully === null
          ? "Cleared."
          : fully
            ? "Marked fully closed."
            : "Marked not fully closed.",
      );
      deals.reload();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3">
      <div className="divide-y hairline border-y hairline">
        {base !== null && base > 0 ? (
          <Line
            label="Base"
            value={e.base !== null ? money(e.base, cur) : "n/a"}
            sub={
              e.base !== null
                ? "For the month"
                : `${money(base, cur)} a month; pick a month to see it counted`
            }
          />
        ) : null}
        {e.intros !== null && perIntro !== null ? (
          <Line
            label="Qualified intros"
            value={money(e.intros, cur)}
            sub={`${count(qualified)} × ${money(perIntro, cur)}`}
          />
        ) : null}
        {e.closes !== null && perClose !== null ? (
          <Line
            label="Fully closed deals"
            value={money(e.closes, cur)}
            sub={`${count(e.fullyClosed)} × ${money(perClose, cur)}${
              e.waiting ? `, ${count(e.waiting)} not fully closed yet` : ""
            }`}
          />
        ) : null}
        <Line label="In all so far" value={money(e.total, cur)} />
      </div>
      {deals.data.length ? (
        <ul className="mt-3 space-y-2">
          {deals.data.slice(0, 12).map(d => (
            <li
              key={d.response_id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs"
            >
              <span className="min-w-0 max-w-full truncate">
                <bdi>{d.business_name || d.client_name || "A client"}</bdi>
                <span className="muted"> · {day(d.submitted_at)}</span>
              </span>
              <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                <StatusChip
                  tone={d.fully_closed ? "good" : "neutral"}
                  label={
                    d.fully_closed
                      ? d.fully_closed_by === "paid in full"
                        ? "Paid in full"
                        : "Fully closed"
                      : d.fully_closed_by === "confirmed"
                        ? "Not fully closed"
                        : "Waiting on a manager"
                  }
                />
                {manager && d.fully_closed_by !== "paid in full" ? (
                  <>
                    {!d.fully_closed ? (
                      <button
                        type="button"
                        disabled={busy === d.response_id}
                        onClick={() => void decide(d.response_id, true)}
                        className={button}
                      >
                        Fully closed
                      </button>
                    ) : null}
                    {d.fully_closed || d.fully_closed_by !== "confirmed" ? (
                      <button
                        type="button"
                        disabled={busy === d.response_id}
                        onClick={() => void decide(d.response_id, false)}
                        className={button}
                      >
                        Not fully closed
                      </button>
                    ) : null}
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted mt-3 text-sm">
          No deals from {whose === "your" ? "your" : "their"} leads in this
          window.
        </p>
      )}
      <div className="muted mt-3 space-y-1.5 text-xs">
        {unmarked ? (
          <p>
            {count(unmarked)} past {unmarked === 1 ? "intro is" : "intros are"}{" "}
            not marked yet: only intros marked showed are paid, so mark them on
            the Calendar.
          </p>
        ) : null}
        <p>
          A deal is {whose === "your" ? "yours" : "theirs"} when the New Client
          Form names {whose === "your" ? "you" : "them"} as the setter, or, when
          it names nobody, when {whose === "your" ? "you" : "they"} ran the
          lead's last intro before it was signed. It pays once it fully closes:
          paid in full at signing, or marked fully closed by a manager once the
          client paid past the onboarding fee.
        </p>
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {sub ? <p className="muted text-xs">{sub}</p> : null}
      </div>
      <p className="tabular-nums shrink-0 text-sm font-semibold">{value}</p>
    </div>
  );
}

function Estimate({
  rule,
  rep,
  card,
  fromIso,
  toIso,
  whose,
}: {
  rule: PayRule;
  rep: Rep;
  card: Scorecard | null;
  fromIso: string;
  toIso: string;
  whose: "your" | "their";
}) {
  const deals = useQuery<PayDeal[]>(
    () =>
      supabase
        .from("cockpit_sales_deals")
        .select(
          "response_id,submitted_at,closer,client_name,business_name,cash_collected,contracted_revenue",
        )
        .gte("submitted_at", fromIso)
        .lt("submitted_at", toIso)
        .eq("voided", false)
        .order("submitted_at", { ascending: false })
        .limit(1000),
    [fromIso, toIso],
  );
  const names = useMemo(() => closerNames(rep), [rep]);
  const mine = useMemo(
    () => (deals.data ?? []).filter(d => isTheirDeal(d.closer, names)),
    [deals.data, names],
  );

  if (deals.error)
    return (
      <div className="mt-3">
        <Failed
          what="The signed deals"
          error={deals.error}
          retry={deals.reload}
        />
      </div>
    );
  if (!deals.data)
    return <p className="muted mt-3 text-sm">Loading the deals…</p>;

  const cur = rule.currency || "USD";
  const e = payEstimate(rule, mine);
  const rate = num(rule.cash_rate);
  const pif = num(rule.pif_bonus);
  const perSigned = num(rule.per_signed);
  const nowParts = [e.earned, e.bonuses, e.signed].filter(
    (v): v is number => v !== null,
  );
  const oneCurrency = cur === "USD" || e.earned === null;
  const perShow =
    (num(rule.per_demo_shown) ?? 0) > 0 || (num(rule.per_intro_shown) ?? 0) > 0;
  const closes = card ? num(card.closes) : null;

  return (
    <div className="mt-3">
      {mine.length ? (
        <>
          <div className="divide-y hairline border-y hairline">
            {e.earned !== null && rate !== null ? (
              <Line
                label="Earned so far"
                value={money(e.earned)}
                sub={`${ratePercent(rate)} of ${money(e.cash)} collected`}
              />
            ) : null}
            {e.later !== null && rate !== null ? (
              <Line
                label="Still to earn as it is collected"
                value={money(e.later)}
                sub={
                  e.owed > 0
                    ? `${ratePercent(rate)} of the ${money(e.owed)} still to collect`
                    : "Every contract here is paid up"
                }
              />
            ) : null}
            {e.bonuses !== null && pif !== null ? (
              <Line
                label="Paid-in-full bonuses"
                value={money(e.bonuses, cur)}
                sub={
                  e.paidInFull
                    ? `${count(e.paidInFull)} × ${money(pif, cur)}`
                    : "No client paid in full in this window"
                }
              />
            ) : null}
            {e.signed !== null && perSigned !== null ? (
              <Line
                label="Per signed client"
                value={money(e.signed, cur)}
                sub={`${count(e.deals)} × ${money(perSigned, cur)}`}
              />
            ) : null}
            {oneCurrency && nowParts.length > 1 ? (
              <Line
                label="Earned so far in all"
                value={money(
                  nowParts.reduce((a, b) => a + b, 0),
                  cur,
                )}
              />
            ) : null}
          </div>
          {!oneCurrency ? (
            <p className="muted mt-2 text-xs">
              The share of cash is in dollars, as the deals are; the fixed
              amounts are in {cur}.
            </p>
          ) : null}
          <ul className="mt-3 space-y-1.5">
            {mine.slice(0, 8).map(d => {
              const c = num(d.cash_collected);
              const k = num(d.contracted_revenue);
              return (
                <li
                  key={d.response_id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs"
                >
                  <span className="min-w-0 max-w-full truncate">
                    <bdi>{d.business_name || d.client_name || "A client"}</bdi>
                    <span className="muted"> · {day(d.submitted_at)}</span>
                  </span>
                  <span className="muted shrink-0">
                    <span className="tabular-nums">
                      {money(c)} of {money(k)}
                    </span>
                    {c !== null && k !== null && k > 0 && c >= k ? (
                      <span className="ml-1.5 font-medium text-[color:var(--foreground)]">
                        paid in full
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {mine.length > 8 ? (
            <p className="muted mt-1 text-xs">
              and {count(mine.length - 8)} more deals
            </p>
          ) : null}
        </>
      ) : (
        <p className="muted text-sm">
          No deals signed in this window under{" "}
          {whose === "your" ? "your" : "their"} name.
        </p>
      )}

      <div className="muted mt-3 space-y-1.5 text-xs">
        {e.incomplete ? (
          <p>
            {count(e.incomplete)}{" "}
            {e.incomplete === 1 ? "deal has" : "deals have"} no deposit or no
            contract value on the form, so{" "}
            {e.incomplete === 1 ? "it is" : "they are"} left out of what depends
            on it.
          </p>
        ) : null}
        {closes !== null && closes !== mine.length ? (
          <p>
            The scorecard counts {count(closes)}{" "}
            {closes === 1 ? "close" : "closes"} in this window;{" "}
            {count(mine.length)} {mine.length === 1 ? "deal" : "deals"} on the
            New Client Form carry {whose === "your" ? "your" : "their"} closer
            name.
          </p>
        ) : null}
        {perShow ? <p>Pay per show is not in this estimate yet.</p> : null}
        <p>
          From the deposits recorded on the New Client Form. Payments after the
          deposit are added once collections are tracked here.
        </p>
      </div>
    </div>
  );
}
