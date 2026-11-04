import { digits } from "../../content";
import type { SlideCtx } from "../../deckContext";
import { OFFER_CHROME as C } from "../content/shared";
import { firstYearUsd, formatMoney, inCurrency } from "../price";
export function ReturnCard({ ctx }: { ctx: SlideCtx }) {
  const m = ctx.offer;
  if (!m?.opening || !m.row) return null;
  const raw = m.prep.project_value as
    | { amount?: number; currency?: string; from?: string; said_on?: string }
    | undefined;
  const sheet = m.sources.project.sheet;
  const project =
    raw?.amount && raw.currency
      ? {
          amount: raw.amount,
          currency: raw.currency,
          from: raw.from ?? "typed",
          on: raw.said_on,
        }
      : sheet
        ? {
            ...inCurrency(sheet.usd, m.sources.currency, m.sources.fx.usdPer),
            from: "sheet",
            on: undefined,
          }
        : null;
  const year = firstYearUsd(m.opening, m.row);
  if (year === null) return null;
  if (!project)
    return (
      <div className="dko-return">
        <div>
          <span>{C.typicalProject[ctx.lang]}</span>
          <label>
            {C.yourFigure[ctx.lang]}
            <input
              className="dko-live-figure"
              type="number"
              min="1"
              aria-label={C.yourFigure[ctx.lang]}
              onKeyDown={e => e.stopPropagation()}
              onBlur={e => {
                const amount = Number(e.target.value);
                if (
                  Number.isFinite(amount) &&
                  amount > 0 &&
                  amount <= 100000000
                )
                  ctx.save(
                    {
                      project_value: {
                        amount,
                        currency: m.sources.currency,
                        from: "typed",
                        said_on: new Date().toISOString().slice(0, 10),
                      },
                    },
                    true,
                  );
              }}
            />
          </label>
        </div>
        <div>
          <span>{C.thisFirstYear[ctx.lang]}</span>
          <strong>
            {formatMoney(
              inCurrency(year, m.sources.currency, m.sources.fx.usdPer).amount,
              inCurrency(year, m.sources.currency, m.sources.fx.usdPer)
                .currency,
              ctx.lang,
            )}
          </strong>
        </div>
      </div>
    );
  const local = inCurrency(
    year,
    project.currency,
    m.sources.currency === project.currency ? m.sources.fx.usdPer : null,
  );
  return (
    <div className="dko-return">
      <div>
        <span>{C.typicalProject[ctx.lang]}</span>
        <strong>
          {formatMoney(project.amount, project.currency, ctx.lang)}
        </strong>
        <small>
          {project.from === "sheet"
            ? C.fromSheet[ctx.lang]
            : project.from === "onboarding"
              ? C.fromAnswer[ctx.lang].replace(
                  "{date}",
                  digits(project.on ?? "", ctx.lang),
                )
              : C.yourFigure[ctx.lang]}
          {project.on && project.from !== "onboarding"
            ? ` · ${digits(project.on, ctx.lang)}`
            : ""}
        </small>
      </div>
      <div>
        <span>{C.thisFirstYear[ctx.lang]}</span>
        <strong>{formatMoney(local.amount, local.currency, ctx.lang)}</strong>
        <small>
          <bdi dir="ltr">
            {m.row.parts
              .map(
                p =>
                  `${formatMoney(m.opening![p.key], "USD", ctx.lang)}${p.cadence === "monthly" ? ` × ${digits(12, ctx.lang)}` : ""}`,
              )
              .join(" + ")}
          </bdi>
        </small>
      </div>
    </div>
  );
}
