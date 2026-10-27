import type { MouseEvent, ReactNode } from "react";
import adKitchen from "./assets/proof/ad-kitchen.webp";
import adOwner from "./assets/proof/ad-owner.webp";
import adReno from "./assets/proof/ad-reno.webp";
import jrBooked from "./assets/proof/jr-booked.webp";
import jrForm3 from "./assets/proof/jr-form-3.webp";
import jrLandingPhone from "./assets/proof/jr-landing-phone.webp";
import jrSlack from "./assets/proof/jr-slack.webp";
import pcmCall from "./assets/proof/pcm-call.webp";
import pcmLesson from "./assets/proof/pcm-lesson.webp";
import {
  type Lang,
  PILLARS,
  type PillarKey,
  SYSTEM,
  stepLabel,
  t,
} from "./content";
import { Rv } from "./parts";
import type { DeckCtx } from "./slides";
import {
  ADS,
  ALERT,
  BODY,
  bottomAt,
  CLOSING,
  type Cut,
  DATA,
  DATA_LABEL_OPEN,
  DROP,
  FILTER,
  GRAD,
  HOLE,
  LABELS,
  LEAD_COUNT,
  LENS_PAD,
  LOOP,
  LOOP_HEAD,
  LOOP_SAY,
  lensFor,
  NOTE_OUT,
  PORTAL_BAR,
  SALES,
  type Screen,
  SPAN,
  screenStyle,
  systemCss,
  WALL_BOTTOM,
  WALL_TOP,
} from "./systemPlan";
import { PORTAL_TOUR } from "./tour";

/**
 * The five-step slide (the CEO, 2026-10-27: "make it more visual so they can
 * see the whole funnel ... this is the client journey and a bit of a preview
 * of each ... and then how we scale it"). The overview is one funnel: real
 * ads at its wide mouth, the partner's landing page, the five-minute alert,
 * a real check-in call, and the portal it pours into, with the time-wasters
 * leaving through its floor and a loop from the portal back to the ads.
 * → walks the five steps on the same drawing: each step's screen opens to a
 * size that reads on a shared screen, the others step back, and the last
 * stop lights the loop with the portal tour's own line. The geometry is
 * systemPlan.ts; the words are PILLARS and SYSTEM in content.ts.
 */

/** The ads' stills, for the deck to load ahead of the slide. */
export const SYSTEM_PHOTOS = [adOwner, adKitchen, adReno];

const CSS = systemCss();

const AD_PIC: Record<
  (typeof ADS)[number]["key"],
  { src: string; alt: string }
> = {
  owner: { src: adOwner, alt: "An ad: the owner on camera" },
  kitchen: { src: adKitchen, alt: "An ad: kitchen and bath" },
  reno: { src: adReno, alt: "An ad: a renovation handed over" },
};

const both = (src: string): Record<Lang, string> => ({ en: src, ar: src });

const RESULTS_SRC = PORTAL_TOUR.find(s => s.key === "results")?.src ?? both("");
const SCALE_LINE = PORTAL_TOUR.find(s => s.key === "leads")?.why;

const LENS_PIC: Partial<
  Record<PillarKey, { src: Record<Lang, string>; alt: string }>
> = {
  filter: { src: both(jrForm3), alt: "The budget question on the form" },
  sales: {
    src: both(jrBooked),
    alt: "A booking, with its budget and timeline",
  },
  closing: { src: both(pcmLesson), alt: "Objections, in the closing course" },
  data: {
    src: RESULTS_SRC,
    alt: "Projects won, on the portal's results screen, in a demo workspace",
  },
};

/** A screenshot cut to the part that matters, drawn at a width. */
function Crop({
  src,
  alt,
  cut,
  width,
}: {
  src: string;
  alt: string;
  cut: Cut;
  width: number;
}) {
  const s = width / cut.crop.w;
  return (
    <span className="dk-sys-cut" style={{ width, height: cut.crop.h * s }}>
      {/* Pinned from the left, so a crop shows the same corner in Arabic. */}
      <img
        src={src}
        alt={alt}
        style={{
          left: -cut.crop.x * s,
          top: -cut.crop.y * s,
          width: cut.img.w * s,
          height: cut.img.h * s,
        }}
      />
    </span>
  );
}

function PhoneFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="dk-sys-phone">
      <span className="dk-sys-screen">
        <img src={src} alt={alt} />
      </span>
      <i className="dk-sys-notch" aria-hidden />
    </span>
  );
}

export function systemSlide(ctx: DeckCtx) {
  return <Funnel ctx={ctx} />;
}

function Funnel({ ctx }: { ctx: DeckCtx }) {
  const { lang, match, setTour } = ctx;
  const rtl = lang === "ar";
  const flip = rtl ? -1 : 1;
  const at = Math.max(0, Math.min(PILLARS.length, ctx.tour));
  const go = (i: number) => setTour(at === i ? 0 : i);
  /** A click opens a step, or closes it; a double click is one click, so it stays open. */
  const pick = (e: MouseEvent, i: number) => {
    if (e.detail <= 1) go(i);
  };
  /** No focus ring left behind by a mouse; the keyboard still gets one. */
  const noRing = (e: MouseEvent) => e.preventDefault();
  const name = (i: number) => t(PILLARS[i - 1].name, lang);
  const matched = (key: PillarKey) => match.includes(key);

  /** How present a step's screens are: all on the overview, one at a stop. */
  const presence = (i: number) => {
    if (at === 0 || at === i) return 1;
    // On the last stop the loop ends at the ads: they stay in sight.
    if (at === 5 && i === 1) return 0.55;
    return at === 5 ? 0.12 : 0.1;
  };

  /**
   * A step's screen: in its overview place, or open. Its label carries the
   * picture's words; the step names are the keyboard's way in.
   */
  const screen = (
    sc: Screen,
    i: number,
    key: string,
    desc: string,
    body: ReactNode,
  ) => {
    const open = at === i;
    return (
      <button
        key={key}
        type="button"
        className="dk-sys-pv"
        style={screenStyle(sc, open, rtl)}
        tabIndex={-1}
        aria-label={`${name(i)}. ${desc}`}
        aria-pressed={open}
        onMouseDown={noRing}
        onClick={e => pick(e, i)}
      >
        <span
          className="dk-sys-tilt"
          style={{
            rotate: open ? "0deg" : `${(sc.rest.rot ?? 0) * flip}deg`,
          }}
        >
          {body}
        </span>
      </button>
    );
  };

  /** The second screen a step brings in when it is open. */
  const lens = (key: PillarKey, i: number) => {
    const l = lensFor(key, lang);
    const pic = LENS_PIC[key];
    if (!l || !pic) return null;
    const open = at === i;
    return (
      <div
        className="dk-sys-lens"
        aria-hidden={!open}
        style={{
          insetInlineStart: l.box.x,
          top: l.box.y,
          width: l.box.w,
          height: l.box.h,
          padding: LENS_PAD,
          opacity: open ? 1 : 0,
          transform: open ? "none" : "translateY(18px) scale(0.97)",
          transitionDelay: open ? "260ms" : "0ms",
          // Open, it takes its own clicks, so pointing at it opens nothing under it.
          pointerEvents: open ? "auto" : "none",
        }}
      >
        <Crop
          src={pic.src[lang]}
          alt={pic.alt}
          cut={l}
          width={l.box.w - 2 * LENS_PAD}
        />
        {/* The portal's figures read here, so the lens says whose they are. */}
        {key === "data" ? (
          <span className="dk-sys-demo">{t(SYSTEM.demo, lang)}</span>
        ) : null}
      </div>
    );
  };

  const steps: { key: PillarKey; body: ReactNode }[] = [
    {
      key: "ads",
      body: ADS.map(a =>
        screen(
          a.screen,
          1,
          a.key,
          AD_PIC[a.key].alt,
          <PhoneFrame src={AD_PIC[a.key].src} alt="" />,
        ),
      ),
    },
    {
      key: "filter",
      body: (
        <>
          {screen(
            FILTER,
            2,
            "page",
            "A partner's landing page on a phone",
            <PhoneFrame src={jrLandingPhone} alt="" />,
          )}
          {lens("filter", 2)}
        </>
      ),
    },
    {
      key: "sales",
      body: (
        <>
          {screen(
            SALES,
            3,
            "alert",
            "New lead: call within 5 minutes",
            <span className="dk-sys-shot">
              <Crop src={jrSlack} alt="" cut={ALERT} width={SALES.open.w} />
            </span>,
          )}
          {lens("sales", 3)}
        </>
      ),
    },
    {
      key: "closing",
      body: (
        <>
          {screen(
            CLOSING,
            4,
            "call",
            "A check-in call with a partner",
            <span className="dk-sys-shot">
              <img src={pcmCall} alt="" />
            </span>,
          )}
          {lens("closing", 4)}
        </>
      ),
    },
    {
      key: "data",
      body: (
        <>
          {screen(
            DATA,
            5,
            "portal",
            "The portal's results screen, in a demo workspace",
            <>
              {/* Its ring lights as a signed project pours in. Grown on the
                  last stop, its door is further up, so that has its own. */}
              <i className="dk-sys-glow" data-k="rest" aria-hidden />
              <i className="dk-sys-glow" data-k="open" aria-hidden />
              <span className="dk-sys-browser">
                <span className="dk-sys-bar" style={{ height: PORTAL_BAR }}>
                  <i />
                  <i />
                  <i />
                  <span>portal.maharamedia.com</span>
                </span>
                <span className="dk-sys-page">
                  <img src={RESULTS_SRC[lang]} alt="" />
                  <span className="dk-sys-demo">{t(SYSTEM.demo, lang)}</span>
                </span>
              </span>
            </>,
          )}
          {lens("data", 5)}
        </>
      ),
    },
  ];

  const header =
    at === 0
      ? { label: "Project to Profit", title: t(SYSTEM.title, lang) }
      : {
          label: stepLabel(PILLARS[at - 1].key, lang),
          title: t(PILLARS[at - 1].line, lang),
        };
  const openKey = at === 0 ? null : PILLARS[at - 1].key;
  const holeTop = bottomAt(HOLE.to);
  const holeBottom = bottomAt(HOLE.from);

  return (
    <>
      <div className="dk-sys" data-at={at}>
        <style>{CSS}</style>

        {/* The drawing, left to right; Arabic mirrors it whole. */}
        <div className="dk-sys-art" aria-hidden>
          <svg width="1920" height="1080" viewBox="0 0 1920 1080" aria-hidden>
            <defs>
              <linearGradient
                id="dk-sys-grad"
                gradientUnits="userSpaceOnUse"
                x1={GRAD.from}
                y1="0"
                x2={GRAD.to}
                y2="0"
              >
                <stop offset="0" stopColor="#2e5bd6" />
                <stop offset="0.65" stopColor="#00cfc8" />
                <stop offset="1" stopColor="#00cfc8" />
              </linearGradient>
              <linearGradient
                id="dk-sys-fill"
                gradientUnits="userSpaceOnUse"
                x1={GRAD.from}
                y1="0"
                x2={GRAD.to}
                y2="0"
              >
                <stop offset="0" stopColor="#2e5bd6" stopOpacity="0.2" />
                <stop offset="0.65" stopColor="#00cfc8" stopOpacity="0.07" />
                <stop offset="1" stopColor="#00cfc8" stopOpacity="0.12" />
              </linearGradient>
              <mask
                id="dk-sys-hole"
                maskUnits="userSpaceOnUse"
                x="0"
                y="0"
                width="1920"
                height="1080"
              >
                <rect x="0" y="0" width="1920" height="1080" fill="#fff" />
                <rect
                  x={HOLE.from}
                  y={holeTop - 24}
                  width={HOLE.to - HOLE.from}
                  height={holeBottom - holeTop + 48}
                  fill="#000"
                />
              </mask>
            </defs>
            <path className="dk-sys-body dk-sys-late" d={BODY} />
            <path className="dk-sys-halo dk-sys-late" d={WALL_TOP} />
            <path
              className="dk-sys-halo dk-sys-late"
              d={WALL_BOTTOM}
              mask="url(#dk-sys-hole)"
            />
            <path
              className="dk-sys-wall dk-sys-draw"
              pathLength={1}
              d={WALL_TOP}
            />
            <g mask="url(#dk-sys-hole)">
              <path
                className="dk-sys-wall dk-sys-draw"
                pathLength={1}
                d={WALL_BOTTOM}
              />
            </g>
            {/* The gap's two ends, rounded like the rest of the wall. */}
            <circle
              className="dk-sys-late"
              cx={HOLE.from}
              cy={holeBottom}
              r="2.5"
              fill="url(#dk-sys-grad)"
            />
            <circle
              className="dk-sys-late"
              cx={HOLE.to}
              cy={holeTop}
              r="2.5"
              fill="url(#dk-sys-grad)"
            />
            <path className="dk-sys-drop dk-sys-late" d={DROP} />
            <g className="dk-sys-span dk-sys-late">
              <path d={`M${SPAN.from},${SPAN.y} H${SPAN.to}`} />
              <path d={`M${SPAN.from},${SPAN.y - 12} V${SPAN.y + 4}`} />
              <path d={`M${SPAN.to},${SPAN.y - 12} V${SPAN.y + 4}`} />
              <path
                d={`M${SPAN.from - 7},${SPAN.y + 7} L${SPAN.from + 7},${SPAN.y - 7}`}
              />
              <path
                d={`M${SPAN.to - 7},${SPAN.y + 7} L${SPAN.to + 7},${SPAN.y - 7}`}
              />
            </g>
            <path
              className="dk-sys-loop dk-sys-loop-draw"
              pathLength={1}
              d={LOOP}
            />
            <path className="dk-sys-loop-head dk-sys-late" d={LOOP_HEAD} />
          </svg>
          <div className="dk-sys-flow">
            {Array.from({ length: LEAD_COUNT }, (_, k) => (
              <i key={k} className="dk-sys-lead" />
            ))}
          </div>
          <i className="dk-sys-ride" />
        </div>

        {steps.map((s, k) => (
          <Rv
            key={s.key}
            i={2 + k}
            className="dk-sys-layer"
            // The open step's screens sit over the others it opens across.
            style={{ zIndex: at === k + 1 ? 2 : 1 }}
          >
            <div
              className="dk-sys-step"
              data-match={matched(s.key) ? "" : undefined}
              style={{ opacity: presence(k + 1) }}
            >
              {s.body}
            </div>
          </Rv>
        ))}

        <Rv i={3} className="dk-sys-layer">
          {PILLARS.map((p, k) => {
            const i = k + 1;
            // On the last stop the grown portal takes the closing name's place.
            const gone = at === 5 && p.key === "closing";
            const spot =
              at === 5 && p.key === "data" ? DATA_LABEL_OPEN : LABELS[p.key];
            return (
              <button
                key={p.key}
                type="button"
                className="dk-sys-name"
                data-on={at === i ? "" : undefined}
                data-match={matched(p.key) ? "" : undefined}
                data-gone={gone ? "" : undefined}
                tabIndex={gone ? -1 : undefined}
                aria-hidden={gone || undefined}
                style={{ insetInlineStart: spot.x, top: spot.y }}
                aria-label={t(p.name, lang)}
                aria-pressed={at === i}
                onMouseDown={noRing}
                onClick={e => pick(e, i)}
              >
                {/* No leading zero in Arabic: ٠ is a dot, so ٠١ reads as ·١. */}
                <b className="dk-num">{rtl ? "١٢٣٤٥"[k] : `0${i}`}</b>
                <span>{t(p.short, lang)}</span>
              </button>
            );
          })}
        </Rv>

        {/* The words on the drawing come in with the lines they name. */}
        <Rv i={18} className="dk-sys-layer">
          <span
            className="dk-sys-min"
            style={{
              insetInlineStart: (SPAN.from + SPAN.to) / 2,
              top: SPAN.y - 44,
            }}
          >
            {t(SYSTEM.minutes, lang)}
          </span>
          <span
            className="dk-sys-note"
            style={{ insetInlineStart: NOTE_OUT.x, top: NOTE_OUT.y }}
          >
            {t(SYSTEM.out, lang)}
          </span>
          <span
            key={at === 5 ? "long" : "short"}
            className="dk-sys-say"
            style={{ insetInlineStart: LOOP_SAY.x, top: LOOP_SAY.y }}
          >
            {at === 5 && SCALE_LINE
              ? t(SCALE_LINE, lang)
              : t(SYSTEM.loop, lang)}
          </span>
        </Rv>
      </div>

      <div className="dk-sys-head">
        <Rv key={`label-${at}`} i={0}>
          <p className="dk-label">
            {header.label}
            {openKey && matched(openKey) ? (
              <span className="dk-sys-match">{t(SYSTEM.match, lang)}</span>
            ) : null}
          </p>
        </Rv>
        <Rv key={`title-${at}`} i={1}>
          <h2 className={at === 0 ? "dk-h2" : "dk-sys-line"}>{header.title}</h2>
        </Rv>
      </div>
    </>
  );
}
