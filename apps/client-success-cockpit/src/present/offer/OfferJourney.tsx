import { digits } from "../content";
import type { SlideCtx } from "../deckContext";
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
      <div className="dko-journey-position" aria-hidden="true">
        <span className="dko-eyebrow">{copy.name}</span>
        <div className="dko-journey-counter">
          <strong key={active}>{number(active)}</strong>
          <span>/ {number(copy.steps.length - 1)}</span>
        </div>
        <div className="dko-journey-track">
          {copy.steps.map((step, i) => (
            <i key={step.key} data-reached={i <= active} />
          ))}
        </div>
      </div>
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
