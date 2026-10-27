import { digits, fill, type Lang } from "../content";
import type { SlideCtx, SlideDef } from "../deckContext";
import { OfferIcon, type OfferIconName } from "./art";
import { OFFER_CHROME as C } from "./content/shared";
import {
  WEBSITE_DECK as W,
  WEBSITE_SLIDES,
  WEBSITE_STOPS,
  type WebsiteSlideId,
} from "./content/website";
import { OfferCover } from "./OfferCover";
import { formatMoney } from "./price";
import { Bill } from "./slides/Bill";
import { Capture } from "./slides/Capture";
import { Commit } from "./slides/Commit";
import { ReturnCard } from "./slides/ReturnCard";
import { SiteSketch } from "./slides/SiteSketch";
import { type OfferModel, offerCopy } from "./useOffer";
import { offerVideoItems } from "./videos";
import { websiteExampleSlide } from "./WebsiteExample";
import "./offer.css";

function Canvas({ id, ctx }: { id: WebsiteSlideId; ctx: SlideCtx }) {
  const s = W.slides[id],
    m = ctx.offer,
    copy = m ? offerCopy(m, ctx.lang) : null,
    stop = WEBSITE_STOPS[id][ctx.tour] ?? WEBSITE_STOPS[id][0];
  const line =
    id === "get" &&
    stop === "drawn" &&
    (!ctx.d.logo ||
      !Array.isArray(ctx.prep.example_stills) ||
      !ctx.prep.example_stills.length)
      ? s.lines?.drawn_plain?.[ctx.lang]
      : s.stops[stop]?.[ctx.lang];
  return (
    <section
      className={`dko-slide dko-${id}`}
      dir={ctx.lang === "ar" ? "rtl" : "ltr"}
      data-stop={stop}
      data-still={ctx.still}
    >
      <header className="dko-slide-head">
        <span className="dko-eyebrow">{ctx.d.name}</span>
        <h1>{s.title[ctx.lang]}</h1>
      </header>
      {id === "saw" ? (
        <>
          <Capture ctx={ctx} />
          <div className="dko-sentence">
            {ctx.tour === 1
              ? s.lines?.[
                  m?.prep.site_thin
                    ? "cloud_thin"
                    : m?.sources.site.verdict === "broken"
                      ? "cloud_broken"
                      : "cloud_none"
                ]?.[ctx.lang]
              : line}
          </div>
        </>
      ) : null}
      {id === "matters" ? (
        <div className="dsv-website-opening">
          <OfferCover offer="website" copy={copy} />
          <div className="dko-words">
            {ctx.tour === 0 && m?.goal ? (
              <>
                <span className="dko-eyebrow">
                  {s.lines?.[m.goal.key]?.[ctx.lang]}
                </span>
                <blockquote>{m.goal.answer}</blockquote>
                {m.goal.on ? (
                  <small>
                    {fill(C.fromAnswer[ctx.lang], {
                      date: digits(m.goal.on, ctx.lang),
                    })}
                  </small>
                ) : null}
              </>
            ) : (
              <h2>
                {ctx.tour === 0 ? s.lines?.words_empty?.[ctx.lang] : line}
              </h2>
            )}
          </div>
        </div>
      ) : null}
      {id === "get" ? (
        <div className="dko-get-layout">
          <SiteSketch ctx={ctx} />
          <div className="dko-get-detail">
            {stop === "need" ? (
              <>
                <span className="dko-eyebrow dko-amber">
                  {C.weNeed[ctx.lang]}
                </span>
                {copy?.need.map(v => (
                  <div className="dko-need" key={v.key}>
                    <OfferIcon
                      name={v.key as OfferIconName}
                      tone="leak"
                      size={48}
                    />
                    <p>{v.text}</p>
                  </div>
                ))}
              </>
            ) : (
              <>
                <OfferIcon
                  name={(stop === "drawn" ? "pages" : stop) as OfferIconName}
                  size={64}
                  tone="teal"
                />
                <h2>{line}</h2>
                {stop !== "drawn" &&
                copy?.get.find(v => v.key === stop)?.text !== line ? (
                  <p>{copy?.get.find(v => v.key === stop)?.text}</p>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
      {id === "investment" ? (
        <>
          <Bill ctx={ctx} />
          {ctx.tour >= 1 ? <ReturnCard ctx={ctx} /> : null}
          {ctx.tour >= 2 ? (
            <div className="dko-sentence">{C.howMany[ctx.lang]}</div>
          ) : null}
        </>
      ) : null}
      {id === "next" ? (
        <>
          <Commit ctx={ctx} />
          {ctx.tour >= 1 ? (
            <div className="dko-sentence dko-teal">{copy?.close ?? line}</div>
          ) : null}
        </>
      ) : null}
      {id === "runs" ? (
        <ol className="dko-run">
          {copy?.steps.map((v, i) => (
            <li key={v.key}>
              <b>{digits(String(i + 1).padStart(2, "0"), ctx.lang)}</b>
              <p>{v.text}</p>
            </li>
          ))}
        </ol>
      ) : null}
      {id === "video" ? (
        <button
          type="button"
          className="dko-video-play"
          onClick={() => {
            const v = offerVideoItems(ctx.d, ctx.lang)[0];
            if (v) ctx.playVideo?.(v);
          }}
        >
          {line}
        </button>
      ) : null}
    </section>
  );
}
function filledNotes(id: WebsiteSlideId, m?: OfferModel | null) {
  const n = W.slides[id].notes;
  const slots = (lang: Lang) => ({
    build: m?.opening ? formatMoney(m.opening.build, "USD", lang) : "",
    care: m?.opening ? formatMoney(m.opening.care, "USD", lang) : "",
    project: "",
  });
  return {
    say: n.say.map(x => fill(x, slots("en"))),
    sayAr: (m?.dialect === "sa" ? n.saySa : n.sayKw).map(x =>
      fill(x, slots("ar")),
    ),
    push: n.push,
    pushAr: m?.dialect === "sa" ? n.pushSa : n.pushKw,
  };
}
export function websiteSlides(m?: OfferModel | null): SlideDef[] {
  const slides: SlideDef[] = [...WEBSITE_SLIDES, "runs", "video"].map(key => {
    const id = key as WebsiteSlideId;
    const missing =
      id === "saw" && !m?.captures.length
        ? ["Add a dated capture before showing What we saw."]
        : id === "investment" && (!m?.opening || m.priceProblem)
          ? [
              m?.priceProblem ??
                "Add an opening price before showing the investment.",
            ]
          : [];
    return {
      id,
      title: W.slides[id].title,
      stops: () => WEBSITE_STOPS[id].length,
      stopName: (i: number) => W.slides[id].stops[WEBSITE_STOPS[id][i]] ?? null,
      defaultHidden: () =>
        id === "runs" || id === "video" || missing.length > 0,
      hiddenWhy: missing[0] ?? "Open only when useful on the call.",
      deep: id === "runs" || id === "video",
      missing: () => missing,
      notes: filledNotes(id, m),
      render: (ctx: SlideCtx) => <Canvas id={id} ctx={ctx} />,
    };
  });
  slides.splice(3, 0, websiteExampleSlide());
  return slides;
}
