import type { SlideCtx } from "../../deckContext";
import { OFFER_CHROME as C } from "../content/shared";
import { offerCopy } from "../useOffer";
export function Commit({ ctx }: { ctx: SlideCtx }) {
  const copy = ctx.offer ? offerCopy(ctx.offer, ctx.lang) : null;
  return (
    <div className="dko-commit">
      <span className="dko-eyebrow">{C.commitTitle[ctx.lang]}</span>
      <h2>{copy?.timing}</h2>
      <ol>
        {copy?.steps.map(s => (
          <li key={s.key}>{s.text}</li>
        ))}
      </ol>
    </div>
  );
}
