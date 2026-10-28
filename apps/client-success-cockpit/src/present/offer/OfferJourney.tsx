import { digits } from "../content";
import type { SlideCtx } from "../deckContext";
import { OfferJourneyScene } from "./OfferJourneyScene";
import type { CatalogCopy } from "./sources";
import "./offerJourney.css";

/** Approved delivery steps. Selection only changes the local presentation position. */
export function OfferJourney({
  copy,
  ctx,
}: {
  copy: CatalogCopy;
  ctx: SlideCtx;
}) {
  const active = Math.max(0, Math.min(ctx.tour, copy.steps.length - 1));
  const number = (i: number) =>
    digits(String(i + 1).padStart(2, "0"), ctx.lang);
  return (
    <div className="dko-journey" data-journey data-still={ctx.still}>
      <OfferJourneyScene copy={copy} ctx={ctx} active={active} />
      <ol className="dko-journey-steps">
        {copy.steps.map((step, i) => (
          <li key={step.key}>
            <button
              type="button"
              aria-current={i === active ? "step" : undefined}
              onClick={event => {
                event.stopPropagation();
                ctx.setTour(i);
              }}
            >
              <span className="dko-journey-number" aria-hidden="true">
                {number(i)}
              </span>
              <span>{step.text}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
