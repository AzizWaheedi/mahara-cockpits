import { digits } from "../../content";
import type { SlideCtx } from "../../deckContext";
import { OFFER_CHROME as C } from "../content/shared";
import { CADENCE } from "../price";
import { offerCopy } from "../useOffer";
export function Bill({ ctx }: { ctx: SlideCtx }) {
  const m = ctx.offer;
  const row = m?.row;
  const price = m?.opening;
  if (!m || !row || !price || m.priceProblem) return null;
  const copy = offerCopy(m, ctx.lang);
  if (!copy) return null;
  return (
    <div className="dko-bill">
      <div className="dko-bill-head">
        <span>{C.item[ctx.lang]}</span>
        <span>{C.description[ctx.lang]}</span>
        <span>{C.dollars[ctx.lang]}</span>
      </div>
      {row.parts.map((p, i) => (
        <div className="dko-bill-row" key={p.key}>
          <span>{digits(String(i + 1).padStart(2, "0"), ctx.lang)}</span>
          <div>
            <strong>{copy.parts[p.key]}</strong>
            <small>{CADENCE[p.cadence][ctx.lang]}</small>
          </div>
          <bdi>
            {digits(
              new Intl.NumberFormat(
                ctx.lang === "ar" ? "ar-u-nu-arab" : "en",
              ).format(price[p.key]),
              ctx.lang,
            )}
          </bdi>
        </div>
      ))}
      <div className="dko-bill-terms">
        <span>{C.terms[ctx.lang]}</span>
        <p>{copy?.terms}</p>
      </div>
    </div>
  );
}
