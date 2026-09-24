import { Wallet } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { useQuery } from "../lib/data";
import { count, day, money, num } from "../lib/format";
import {
  closerNames,
  hasPayRule,
  isTheirDeal,
  payEstimate,
  payWords,
  ratePercent,
} from "../lib/pay";
import { supabase } from "../lib/supabase";
import type { Deal, PayRule, Rep, SalesRole, Scorecard } from "../lib/types";
import { EmptyState, Failed, SectionCard, StatusChip } from "./kit";

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
  whose,
}: {
  rule: PayRule | null;
  role: SalesRole | null;
  /** The B2B rep the seat is linked to, whose closer names the deals carry. */
  rep: Rep | null;
  card: Scorecard | null;
  fromIso: string;
  toIso: string;
  whose: "your" | "their";
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
        <p className="muted mt-3 text-xs">
          Setter pay is not estimated here yet. The rule above is the plan as
          agreed.
        </p>
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
