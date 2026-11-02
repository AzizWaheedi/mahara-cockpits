import { useState } from "react";
import { digits, tf } from "../../content";
import type { SlideCtx } from "../../deckContext";
import { OFFER_CHROME as C } from "../content/shared";
import { RevisionCloud } from "./RevisionCloud";
export function Capture({ ctx }: { ctx: SlideCtx }) {
  const [index, setIndex] = useState(0);
  const captures = ctx.offer?.captures ?? [];
  const f = captures[Math.min(index, captures.length - 1)];
  if (!f?.url) return null;
  return (
    <figure className="dko-capture">
      <div className="dko-record">
        <span>Rev A</span>
        <span>
          {tf(C.captured, ctx.lang, { date: digits(f.capturedOn, ctx.lang) })}
        </span>
        {f.searchedAs ? (
          <span>{tf(C.searchedAs, ctx.lang, { city: f.searchedAs })}</span>
        ) : null}
        {captures.length > 1 ? (
          <span className="dko-capture-pages">
            {captures.map((c, i) => (
              <button
                key={c.id}
                type="button"
                aria-label={tf(C.captured, ctx.lang, {
                  date: digits(c.capturedOn, ctx.lang),
                })}
                aria-pressed={i === index}
                onClick={e => {
                  setIndex(i);
                  e.currentTarget.blur();
                }}
              >
                {digits(String(i + 1).padStart(2, "0"), ctx.lang)}
              </button>
            ))}
          </span>
        ) : null}
      </div>
      <div
        className="dko-capture-well"
        style={
          f.width && f.height
            ? {
                width: Math.min(1696, (510 * f.width) / f.height),
                height: Math.min(510, (1696 * f.height) / f.width),
                marginInline: "auto",
              }
            : undefined
        }
      >
        <img src={f.url} alt={f.caption ?? ""} />
        <RevisionCloud mark={f.mark} on={ctx.tour >= 1} />
      </div>
    </figure>
  );
}
