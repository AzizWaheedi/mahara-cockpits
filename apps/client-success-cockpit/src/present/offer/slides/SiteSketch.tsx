import { Monitor, Smartphone } from "lucide-react";
import { useState } from "react";
import { tf } from "../../content";
import type { SlideCtx } from "../../deckContext";
import { ART } from "../art";
import { OFFER_CHROME as C } from "../content/shared";
import { WEBSITE_DECK } from "../content/website";
import { RevisionCloud } from "./RevisionCloud";
export function SiteSketch({ ctx }: { ctx: SlideCtx }) {
  const [mobile, setMobile] = useState(false);
  const art = ART.website;
  const own = ctx.offer?.stills ?? [];
  const l = WEBSITE_DECK.slides.get.lines ?? {};
  return (
    <figure className="dko-sketch" data-mobile={mobile}>
      <div className="dko-record">
        <span>Rev B</span>
        <span>{tf(C.example, ctx.lang, { name: ctx.d.name })}</span>
      </div>
      <div className="dko-browser">
        <div className="dko-site-top">
          <b className="dko-site-brand">
            {ctx.d.logo ? <img src={ctx.d.logo.url} alt="" /> : null}
            {ctx.d.name}
          </b>
          <span>{l.sketch_projects?.[ctx.lang] ?? ""}</span>
        </div>
        <div className="dko-site-hero">
          {own[0]?.url ? (
            <img src={own[0].url} alt="" />
          ) : art?.hero ? (
            <img src={art.hero} alt={art.heroAlt[ctx.lang]} />
          ) : null}
          <div>
            <span>{l.sketch_services?.[ctx.lang]}</span>
            <strong>{ctx.d.name}</strong>
          </div>
        </div>
        <div className="dko-site-work">
          {own.length
            ? own
                .slice(0, 3)
                .map(a => <img key={a.id} src={a.url ?? ""} alt="" />)
            : art?.backgrounds.map(a => <img key={a.id} src={a.url} alt="" />)}
        </div>
        <RevisionCloud revision="B" on={ctx.tour > 0} />
      </div>
      <div className="dsv-device-picker">
        <button
          type="button"
          aria-label="16:9"
          aria-pressed={!mobile}
          onClick={() => setMobile(false)}
        >
          <Monitor aria-hidden />
          16:9
        </button>
        <button
          type="button"
          aria-label="9:16"
          aria-pressed={mobile}
          onClick={() => setMobile(true)}
        >
          <Smartphone aria-hidden />
          9:16
        </button>
      </div>
    </figure>
  );
}
