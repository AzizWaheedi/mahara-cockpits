import {
  type AgreedBudget,
  DESK_FLOOR_USD,
  deskBudgetSources,
  usdWords,
} from "@/lib/launchModel";

/**
 * The agreed budget under the launch desk's budget field (20261103e): every
 * source the chain found, newest agreed first, with the one the default came
 * from marked by the teal spine. A source within the limit can fill the
 * field in one tap; nothing is sent until the plan is previewed.
 */
export function BudgetSources({
  agreed,
  live,
  cap,
  onUse,
}: {
  agreed: AgreedBudget;
  /** The readiness read's budget: it reads the live Ads card itself. */
  live?: { contractedUsd?: number | null; source?: string | null } | null;
  cap?: number | null;
  onUse?: (usd: number) => void;
}) {
  const sources = deskBudgetSources(agreed, live);
  if (!sources.length)
    return (
      <p className="launch-agreed-empty" data-budget-sources="none">
        No agreed budget yet. The CSM records it at the kickoff; until then a
        media buyer seat can set up to $100 a day.
      </p>
    );
  return (
    <div
      className="launch-agreed"
      role="group"
      aria-labelledby="launch-agreed-title"
    >
      <p className="launch-micro" id="launch-agreed-title">
        Agreed budget
      </p>
      <ul>
        {sources.map(s => {
          const usable =
            !s.used &&
            !s.note &&
            s.usd !== null &&
            s.usd >= DESK_FLOOR_USD &&
            (cap == null || s.usd <= cap) &&
            !!onUse;
          return (
            <li
              key={s.key}
              className={s.used ? "is-default" : s.note ? "is-held" : ""}
              data-budget-source={s.key}
            >
              <span className="launch-agreed-label">{s.label}</span>
              <span className="launch-agreed-usd">
                {s.usd !== null ? usdWords(s.usd) : "Not in dollars"}
              </span>
              {s.used ? (
                <small>Default</small>
              ) : usable ? (
                <button type="button" onClick={() => onUse(s.usd as number)}>
                  Use {usdWords(s.usd as number)}
                </button>
              ) : null}
              {s.note ? (
                <small className="launch-agreed-note">
                  <span className="launch-dot warn" aria-hidden="true" />
                  {s.note}
                </small>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "Limit $80 a day, twice the agreed budget." from the readiness read. */
export function budgetLimitWords(
  cap: number | null | undefined,
  agreedUsd: number | null | undefined,
): string | null {
  if (cap == null || !Number.isFinite(cap)) return null;
  const why =
    agreedUsd != null && agreedUsd > 0
      ? cap === Math.min(5000, agreedUsd * 2)
        ? ", twice the agreed budget"
        : ""
      : cap === 100
        ? " until a budget is agreed"
        : "";
  return `Limit ${usdWords(cap)} a day${why}.`;
}
