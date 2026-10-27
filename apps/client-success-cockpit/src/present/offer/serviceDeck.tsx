import {
  Camera,
  Clapperboard,
  Layers,
  Play,
  Search,
  Share2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { digits, fill, VIDEO } from "../content";
import type { SlideCtx, SlideDef } from "../deckContext";
import { FRAME_ALLOW, FRAME_SANDBOX, usePlayerFrame } from "../VideoPlayer";
import { OFFER_CHROME as C } from "./content/shared";
import { WEBSITE_DECK as W } from "./content/website";
import type { OfferKey } from "./kinds";
import { Bill } from "./slides/Bill";
import { Capture } from "./slides/Capture";
import type { CatalogCopy } from "./sources";
import { type OfferModel, offerCopy } from "./useOffer";
import { offerVideoItems } from "./videos";
import "./serviceDeck.css";

export type ServiceOffer = Exclude<OfferKey, "website">;
const ICONS = {
  second_campaign: Layers,
  seo_geo: Search,
  smm: Share2,
  cameraman: Camera,
  ugc: Clapperboard,
  closer: Users,
};
export const SERVICE_MAIN_SLIDES = [
  "saw",
  "matters",
  "get",
  "runs",
  "investment",
  "next",
] as const;
export type ServiceSlide = (typeof SERVICE_MAIN_SLIDES)[number] | "video";

/** These are the team's reviewed Wistia examples, never arbitrary provider frames. */
export function wistiaExample(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      u.search ||
      u.hash
    )
      return null;
    const match =
      u.hostname === "maharamedia.wistia.com"
        ? /^\/medias\/([a-z0-9]{10})\/?$/.exec(u.pathname)
        : u.hostname === "fast.wistia.net"
          ? /^\/embed\/iframe\/([a-z0-9]{10})\/?$/.exec(u.pathname)
          : null;
    return match ? `https://fast.wistia.net/embed/iframe/${match[1]}` : null;
  } catch {
    return null;
  }
}
const ACTOR_POSTERS: Record<string, string> = {
  qlwysqfu2g: "ee0de9394a4d688f85de81165e1ceb13870c55d2",
  btp2dokvjr: "33e27b2faa619214d4961f7d833a94f98e7a3cdf",
  nix1oq0h3a: "8ecea92509dfb94e6272f3b447f0d3a47aa401b4",
};
/** Full portrait files verified from Wistia media metadata; swatches are tiny blurred previews. */
export function actorPoster(raw: string): string | null {
  const embed = wistiaExample(raw),
    id = embed?.split("/").pop();
  return id && ACTOR_POSTERS[id]
    ? `https://embed-ssl.wistia.com/deliveries/${ACTOR_POSTERS[id]}.jpg`
    : null;
}
function ExamplePlayer({
  url,
  title,
  lang,
}: {
  url: string;
  title: string;
  lang: "en" | "ar";
}) {
  const p = usePlayerFrame({ provider: "wistia", embedUrl: url }, false);
  return (
    <div className="dks-example-player">
      {p.src && p.phase !== "failed" && p.phase !== "blocked" ? (
        <iframe
          ref={p.frame}
          src={p.src}
          title={title}
          sandbox={FRAME_SANDBOX}
          allow={FRAME_ALLOW}
          referrerPolicy="no-referrer"
          onLoad={p.onLoad}
        />
      ) : (
        <a href={url} target="_blank" rel="noreferrer">
          {VIDEO.watch[lang]} {title}
        </a>
      )}
      {p.slow && p.phase === "loading" ? (
        <span role="status">{VIDEO.loading[lang]}</span>
      ) : null}
    </div>
  );
}
export function ActorExamples({
  copy,
  ctx,
}: {
  copy: CatalogCopy;
  ctx: SlideCtx;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  const examples = copy.work
    .flatMap(w => {
      const embed = wistiaExample(w.url);
      return embed ? [{ ...w, embed }] : [];
    })
    .slice(0, 3);
  if (!examples.length)
    return (
      <div className="dks-casting-empty">
        <Clapperboard aria-hidden />
        <p>{copy.get[0]?.text}</p>
      </div>
    );
  return (
    <div className="dks-casting" data-actor-examples>
      {examples.map((w, i) => (
        <figure key={w.key} className={playing === w.key ? "is-playing" : ""}>
          <div className="dks-casting-screen">
            {playing === w.key ? (
              <ExamplePlayer
                key={w.key}
                url={w.embed}
                title={w.label}
                lang={ctx.lang}
              />
            ) : (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  setPlaying(w.key);
                }}
                aria-label={fill(VIDEO.labelBare[ctx.lang], { title: w.label })}
              >
                {actorPoster(w.url) ? (
                  <img
                    className="dks-actor-poster"
                    src={actorPoster(w.url)!}
                    alt=""
                    onError={e => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}
                <span className="dks-reel-number">
                  {digits(String(i + 1).padStart(2, "0"), ctx.lang)}
                </span>
                <Play aria-hidden />
                <span>{VIDEO.watch[ctx.lang]}</span>
              </button>
            )}
          </div>
          <figcaption>{w.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}
function ScopeVisual({
  kind,
  copy,
  ctx,
  active,
}: {
  kind: ServiceOffer;
  copy: CatalogCopy;
  ctx: SlideCtx;
  active: number;
}) {
  const Icon = ICONS[kind];
  const stills = ctx.offer?.stills ?? [];
  if (kind === "ugc") return <ActorExamples copy={copy} ctx={ctx} />;
  if (kind === "second_campaign")
    return (
      <div className="dks-service-map">
        <div className="dks-map-root">
          <Icon aria-hidden />
          <strong>{ctx.d.name}</strong>
        </div>
        <div className="dks-map-branches">
          {copy.get.slice(0, 4).map((v, i) => (
            <div data-active={active === i} key={v.key}>
              <i aria-hidden />
              <p>{v.text}</p>
            </div>
          ))}
        </div>
      </div>
    );
  if (kind === "seo_geo")
    return (
      <div className="dks-dossier">
        {copy.get.slice(0, 3).map((v, i) => (
          <article key={v.key} data-active={active === i}>
            <Search aria-hidden />
            <p>{v.text}</p>
            <div className="dks-document-lines" aria-hidden>
              <i />
              <i />
              <i />
            </div>
          </article>
        ))}
      </div>
    );
  if (kind === "smm")
    return (
      <div className="dks-editorial">
        <div className="dks-platforms">
          {Object.values(copy.platforms ?? {}).map(v => (
            <span key={v}>{v}</span>
          ))}
        </div>
        <div className="dks-contact-sheet">
          {copy.get.slice(0, 6).map((v, i) => (
            <article key={v.key} data-active={active === i}>
              {stills[i % Math.max(stills.length, 1)]?.url ? (
                <img src={stills[i % stills.length].url!} alt="" />
              ) : (
                <Share2 aria-hidden />
              )}
              <p>{v.text}</p>
            </article>
          ))}
        </div>
      </div>
    );
  if (kind === "cameraman")
    return (
      <div className="dks-storyboard">
        {copy.get.slice(0, 3).map((v, i) => (
          <figure key={v.key} data-active={active === i}>
            <div>
              {stills[i]?.url ? (
                <img src={stills[i].url!} alt="" />
              ) : (
                <Camera aria-hidden />
              )}
              <span className="dks-shot-corner" aria-hidden />
            </div>
            <figcaption>{v.text}</figcaption>
          </figure>
        ))}
      </div>
    );
  return (
    <div className="dks-hiring">
      {copy.get.map((v, i) => (
        <article key={v.key} data-active={active === i}>
          <span aria-hidden>
            {digits(String(i + 1).padStart(2, "0"), ctx.lang)}
          </span>
          <p>{v.text}</p>
        </article>
      ))}
    </div>
  );
}
function ServiceCanvas({
  id,
  kind,
  ctx,
}: {
  id: ServiceSlide;
  kind: ServiceOffer;
  ctx: SlideCtx;
}) {
  const copy = ctx.offer ? offerCopy(ctx.offer, ctx.lang) : null;
  if (!copy) return null;
  const active = ctx.tour - 1;
  const need = ctx.tour > copy.get.length;
  const Icon = ICONS[kind];
  const title =
    id === "matters"
      ? copy.deckTitle
      : id === "video"
        ? copy.name
        : W.slides[id].title[ctx.lang];
  return (
    <section
      className={`dko-slide dks-slide dks-${kind} dks-${id}`}
      dir={ctx.lang === "ar" ? "rtl" : "ltr"}
      data-offer={kind}
      data-stop={ctx.tour}
    >
      <header className="dko-slide-head">
        <span className="dko-eyebrow">{ctx.d.name}</span>
        <h1>{title}</h1>
      </header>
      {id === "saw" ? <Capture ctx={ctx} /> : null}
      {id === "matters" ? (
        <div className="dks-opening">
          <div className="dks-offer-symbol">
            <Icon aria-hidden />
          </div>
          <div>
            {ctx.offer?.goal ? (
              <>
                <blockquote>{ctx.offer.goal.answer}</blockquote>
                {ctx.offer.goal.on ? (
                  <small>
                    {fill(C.fromAnswer[ctx.lang], {
                      date: digits(ctx.offer.goal.on, ctx.lang),
                    })}
                  </small>
                ) : null}
              </>
            ) : (
              <h2>{copy.line}</h2>
            )}
            <p>{ctx.offer?.goal ? copy.line : copy.why[0]?.text}</p>
          </div>
        </div>
      ) : null}
      {id === "get" ? (
        <>
          <div className="dks-scope">
            <ScopeVisual kind={kind} copy={copy} ctx={ctx} active={active} />
            <aside>
              {need ? (
                <>
                  <span className="dko-eyebrow">{C.weNeed[ctx.lang]}</span>
                  <ul>
                    {copy.need.map(v => (
                      <li key={v.key}>{v.text}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <span className="dko-eyebrow">{copy.name}</span>
                  <h2>{active >= 0 ? copy.get[active]?.text : copy.line}</h2>
                  <div className="dks-scope-progress" aria-hidden>
                    {copy.get.map((v, i) => (
                      <i data-active={i === active} key={v.key} />
                    ))}
                  </div>
                </>
              )}
            </aside>
          </div>
          {kind !== "ugc" ? (
            <div className="dks-example-label">
              {fill(C.example[ctx.lang], { name: ctx.d.name })}
            </div>
          ) : null}
        </>
      ) : null}
      {id === "runs" ? (
        <div className="dks-process">
          {copy.steps.map((v, i) => (
            <article key={v.key} data-current={i === ctx.tour}>
              <span>{digits(String(i + 1).padStart(2, "0"), ctx.lang)}</span>
              <p>{v.text}</p>
            </article>
          ))}
        </div>
      ) : null}
      {id === "investment" ? (
        <div className="dks-investment">
          <Bill ctx={ctx} />
          {copy.timing ? <p className="dks-timing">{copy.timing}</p> : null}
        </div>
      ) : null}
      {id === "next" ? (
        <div className="dks-close">
          <span className="dko-eyebrow">{C.commitTitle[ctx.lang]}</span>
          <h2>{ctx.tour === 0 ? copy.timing : copy.close}</h2>
          {ctx.tour === 0 ? <p>{copy.line}</p> : <p>{copy.cta}</p>}
        </div>
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
          <Play aria-hidden />
          {VIDEO.watch[ctx.lang]} {copy.name}
        </button>
      ) : null}
    </section>
  );
}
/** Catalog wording and timing remain authoritative; each offer has its own visual instrument. */
export function serviceSlides(
  kind: ServiceOffer,
  m?: OfferModel | null,
): SlideDef[] {
  const en = m?.row ? offerCopy(m, "en") : null;
  const ar = m?.row ? offerCopy(m, "ar") : null;
  return [...SERVICE_MAIN_SLIDES, "video" as const].map(id => {
    const total =
      id === "get"
        ? (en?.get.length ?? 0) + 2
        : id === "runs"
          ? Math.max(1, en?.steps.length ?? 1)
          : id === "next"
            ? 2
            : 1;
    const missing =
      id === "saw" && !m?.captures.length
        ? ["Add real evidence to use this slide."]
        : id === "investment" && (!m?.opening || m.priceProblem)
          ? [
              m?.priceProblem ??
                "Add an opening price before showing the investment.",
            ]
          : [];
    const say =
      id === "runs"
        ? en?.steps.map(v => v.text)
        : id === "get"
          ? en?.get.map(v => v.text)
          : id === "investment"
            ? [en?.terms]
            : id === "next"
              ? [en?.close]
              : [en?.line];
    const sayAr =
      id === "runs"
        ? ar?.steps.map(v => v.text)
        : id === "get"
          ? ar?.get.map(v => v.text)
          : id === "investment"
            ? [ar?.terms]
            : id === "next"
              ? [ar?.close]
              : [ar?.line];
    return {
      id,
      title:
        id === "matters"
          ? {
              en: en?.deckTitle ?? "Your next step",
              ar: ar?.deckTitle ?? W.slides.matters.title.ar,
            }
          : id === "video"
            ? { en: en?.name ?? "", ar: ar?.name ?? "" }
            : W.slides[id].title,
      stops: () => total,
      stopName: () => null,
      defaultHidden: () => id === "video" || missing.length > 0,
      hiddenWhy: missing[0] ?? "Open the video only when useful on the call.",
      deep: id === "video",
      missing: () => missing,
      notes: {
        say: (say ?? []).filter((v): v is string => !!v),
        sayAr: (sayAr ?? []).filter((v): v is string => !!v),
        push: [],
        pushAr: [],
      },
      render: (ctx: SlideCtx) => (
        <ServiceCanvas key={kind + id} id={id} kind={kind} ctx={ctx} />
      ),
    };
  });
}
