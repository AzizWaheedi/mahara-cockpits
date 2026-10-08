import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type L,
  type Lang,
  MARKETS,
  PLATFORM_NAMES,
  type Platform,
  recommend,
  SERVICES,
  t,
} from "./content";
import { justify } from "./layout";
import { CountUp, LogoRiver } from "./motion";
import { LivePage, OPEN_DOC, OpenChip, TRY_LIVE } from "./overlay";
import { Out, Rv, Wistia, YouTube } from "./parts";
import { Logo, MARK_ORDER, Mark, type PlatformMark } from "./platforms";
import {
  caseUrl,
  LOGO_WALL,
  type Media,
  NUMBER_ONE,
  type Pic,
  REVIEW_PAGES,
  type Stop,
  type StoryProof,
} from "./proof";
import type { DeckCtx } from "./slides";

/**
 * The deck's proof pages and its step-by-step tours (Aziz, 2026-10-07: the
 * portal tour "is very good, so I want to do something similar" for the
 * other steps). A tour is one slide whose stops → walks before the slide
 * moves on; each stop says what it is, what it does and why it matters to
 * the partner, beside the real screens it is about. Every picture is laid
 * out to the box it gets, so a wide alert and a tall script page both show
 * as large as the slide allows.
 */

const ar = (lang: Lang) => lang === "ar";

const WHY: L = { en: "Why it matters to you", ar: "ليش يهمك" };

const PHONE_BEZEL = 12;

interface Box {
  w: number;
  h: number;
}

/**
 * The size of the element in canvas pixels. The canvas is scaled with a
 * transform, which layout sizes ignore, so these are the 1920 × 1080 numbers.
 */
function useBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setBox(b => (b && b.w === w && b.h === h ? b : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
}

/** A box that fills its parent and hands its size to what it holds. */
export function Fit({
  children,
  className = "",
}: {
  children: (box: Box) => ReactNode;
  className?: string;
}) {
  const [ref, box] = useBox();
  return (
    <div ref={ref} className={`dk-fit ${className}`}>
      {box && box.w > 0 && box.h > 0 ? children(box) : null}
    </div>
  );
}

// ------------------------------------------------------------ the pieces

/**
 * A picture, or, when it is a page of a document we can share, a link to
 * that document with a chip that says so on hover (proof.ts BRAND_DNA_DOC,
 * SCRIPTS_DOC). With no link set it stays a picture: nothing to click.
 */
function Shot({
  pic,
  lang,
  className,
  style,
}: {
  pic: Pic;
  lang: Lang;
  className: string;
  style: CSSProperties;
}) {
  const img = <img src={pic.src} alt={pic.alt} />;
  return pic.doc ? (
    <a
      className={className}
      style={style}
      data-link=""
      href={pic.doc}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`${pic.alt}. ${t(OPEN_DOC, lang)}`}
    >
      {img}
      <OpenChip>{t(OPEN_DOC, lang)}</OpenChip>
    </a>
  ) : (
    <figure className={className} style={style}>
      {img}
    </figure>
  );
}

/** Real screenshots, laid out in rows that fill the box. */
function Gallery({
  pics,
  box,
  lang,
  gap = 22,
}: {
  pics: Pic[];
  box: Box;
  lang: Lang;
  gap?: number;
}) {
  const rows = justify(
    pics.map(p => p.r),
    box.w,
    box.h,
    gap,
    pics.map(p => p.w),
  );
  return (
    <div className="dk-gallery" style={{ gap }}>
      {rows.map(row => (
        <div
          key={row.map(p => p.i).join("-")}
          className="dk-gallery-row"
          style={{ gap }}
        >
          {row.map(p => (
            <Shot
              key={pics[p.i].src}
              pic={pics[p.i]}
              lang={lang}
              className="dk-shot"
              style={{ width: p.w, height: p.h }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A stack of real documents, fanned out; the last one lies on top. */
function Fan({ pics, box, lang }: { pics: Pic[]; box: Box; lang: Lang }) {
  // Room left at the edges for the tilt and the lift.
  const h = Math.round(Math.min(box.h * 0.84, ...pics.map(p => p.w / p.r)));
  const widths = pics.map(p => p.r * h);
  const last = widths[widths.length - 1];
  const step = Math.min(
    (box.w - 56 - last) / Math.max(1, pics.length - 1),
    Math.max(...widths) * 0.78,
  );
  const span = step * (pics.length - 1) + last;
  const mid = (pics.length - 1) / 2;
  return (
    <div className="dk-fan" style={{ width: span, height: box.h }}>
      {pics.map((p, i) => (
        <Shot
          key={p.src}
          pic={p}
          lang={lang}
          className="dk-fan-page"
          style={
            {
              width: widths[i],
              height: h,
              insetInlineStart: step * i,
              zIndex: i + 1,
              "--rot": `${(i - mid) * 3}deg`,
              "--lift": `${Math.abs(i - mid) * 10}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** A phone around a screen: its width follows the screen's shape. */
function Phone({
  height,
  ratio,
  children,
  className = "",
}: {
  height: number;
  /** The screen's width over its height. */
  ratio: number;
  children: ReactNode;
  className?: string;
}) {
  const screenH = height - PHONE_BEZEL * 2;
  return (
    <div
      className={`dk-phone ${className}`}
      style={{ width: screenH * ratio + PHONE_BEZEL * 2, height }}
    >
      <div className="dk-phone-screen">{children}</div>
      <i className="dk-phone-notch" aria-hidden />
    </div>
  );
}

/** The tallest phone that lets n phones and their gaps fit the box. */
function phoneHeight(
  box: Box,
  n: number,
  ratio: number,
  gap: number,
  cap = 700,
) {
  const each = (box.w - gap * (n - 1)) / n;
  const byWidth = (each - PHONE_BEZEL * 2) / ratio + PHONE_BEZEL * 2;
  return Math.floor(Math.min(box.h, byWidth, cap));
}

/**
 * The same page in a browser and on a phone, the phone in front. With a
 * live address, the pair is one button that opens the real page in a
 * pop-up (overlay.tsx), and hovering it says so.
 */
function Devices({
  desktop,
  phone,
  box,
  live,
  lang,
}: {
  desktop: Pic;
  phone: Pic;
  box: Box;
  live?: string;
  lang: Lang;
}) {
  const [open, setOpen] = useState(false);
  // Pointing at the pair starts the live page loading, a head start on the click.
  const [warm, setWarm] = useState(false);
  const bar = 44;
  // The browser takes the height; the phone overlaps its far corner.
  let bh = box.h - 24;
  let bw = (bh - bar) * desktop.r;
  let ph = Math.round(bh * 0.84);
  let pw = (ph - PHONE_BEZEL * 2) * phone.r + PHONE_BEZEL * 2;
  const total = bw + pw * 0.62;
  if (total > box.w) {
    const k = box.w / total;
    bh *= k;
    bw *= k;
    ph = Math.round(ph * k);
    pw *= k;
  }
  const size = { width: bw + pw * 0.62, height: bh + 24 };
  const pair = (
    <>
      <div className="dk-browser" style={{ width: bw, height: bh }}>
        <div className="dk-browser-bar">
          <i />
          <i />
          <i />
        </div>
        <img
          src={desktop.src}
          alt={desktop.alt}
          style={{ width: bw, height: bh - bar, objectFit: "cover" }}
        />
      </div>
      <Phone height={ph} ratio={phone.r} className="dk-devices-phone">
        <img src={phone.src} alt={phone.alt} />
      </Phone>
    </>
  );
  if (!live)
    return (
      <div className="dk-devices" style={size}>
        {pair}
      </div>
    );
  return (
    <>
      <button
        type="button"
        className="dk-devices"
        data-link=""
        style={size}
        aria-haspopup="dialog"
        aria-label={t(TRY_LIVE, lang)}
        onPointerEnter={() => setWarm(true)}
        onFocus={() => setWarm(true)}
        onClick={() => setOpen(true)}
      >
        {pair}
        <OpenChip center expand>
          {t(TRY_LIVE, lang)}
        </OpenChip>
      </button>
      {/* Out of sight, from the first hover: the page's pictures are large,
          so they start before the click, never in the background of a call
          that does not open it (the page is a static demo, no tracking). */}
      {warm ? (
        <span className="dk-live-warm" aria-hidden>
          <iframe
            src={live}
            title="The landing page, loading ahead"
            tabIndex={-1}
            sandbox="allow-scripts allow-same-origin"
          />
        </span>
      ) : null}
      {open ? (
        <LivePage
          url={live}
          lang={lang}
          desktop={desktop}
          phone={phone}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** A WhatsApp message as it arrived, on WhatsApp's own dark ground. */
function Chat({ pic, width }: { pic: Pic; width: number }) {
  return (
    <figure className="dk-chat" style={{ width }}>
      <figcaption className="dk-chat-head">
        <Logo mark="whatsapp" size={26} />
        <span>WhatsApp</span>
      </figcaption>
      <img src={pic.src} alt={pic.alt} />
    </figure>
  );
}

/**
 * A reel in Instagram's own post card, cut below the reel. Until the card
 * has loaded it stands as a quiet tile with Instagram's mark, not a blank
 * white panel, and the card fades in over it.
 */
function Reel({
  code,
  title,
  on,
  w,
  h,
}: {
  code: string;
  title: string;
  on: boolean;
  w: number;
  h: number;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div
      className="dk-ig"
      data-loaded={on && loaded ? "" : undefined}
      style={{ width: w, height: h }}
    >
      <span className="dk-ig-wait" aria-hidden>
        <Logo mark="instagram" size={56} />
      </span>
      {on ? (
        <iframe
          src={`https://www.instagram.com/reel/${code}/embed/`}
          title={title}
          allow="autoplay; encrypted-media; fullscreen"
          scrolling="no"
          style={{ height: h + 360 }}
          onLoad={() => setLoaded(true)}
        />
      ) : null}
    </div>
  );
}

/** A partner's flags and place, the way the proof page shows them. */
export function Place({ proof, lang }: { proof: StoryProof; lang: Lang }) {
  return (
    <span className="dk-place">
      {proof.flags.map(f => (
        <img
          key={f.src}
          className="dk-flag"
          src={f.src}
          alt={t(f.name, lang)}
        />
      ))}
      <span>{t(proof.place, lang)}</span>
    </span>
  );
}

/** The case study beside a partner's video: its headline and numbers. */
export function CaseBox({ proof, lang }: { proof: StoryProof; lang: Lang }) {
  return (
    <div className="dk-case">
      <p className="dk-label" style={{ fontSize: 20 }}>
        {ar(lang) ? "دراسة الحالة" : "The case study"}
      </p>
      <p className="dk-case-head">{t(proof.head, lang)}</p>
      <div className="dk-case-metrics">
        {proof.metrics.map(m => (
          <div key={m.label.en}>
            <span className="dk-num dk-case-value">{t(m.value, lang)}</span>
            <span className="dk-small">{t(m.label, lang)}</span>
          </div>
        ))}
      </div>
      <Out href={caseUrl(proof.slug, lang)}>
        {ar(lang) ? "اقرأ القصة كاملة" : "Read the full case study"}
      </Out>
    </div>
  );
}

const PLATFORM_MARK: Record<Platform, PlatformMark> = {
  instagram: "instagram",
  snapchat: "snapchat",
  tiktok: "tiktok",
  google: "google",
};

function StopMedia({
  media,
  ctx,
  on,
  box,
}: {
  media: Media;
  ctx: DeckCtx;
  on: boolean;
  box: Box;
}) {
  const { lang } = ctx;
  switch (media.kind) {
    case "shots":
      return media.fan ? (
        <Fan pics={media.items} box={box} lang={lang} />
      ) : (
        <Gallery pics={media.items} box={box} lang={lang} />
      );
    case "phones": {
      const gap = 40;
      const h = phoneHeight(box, media.items.length, media.items[0].r, gap);
      return (
        <div className="dk-row" style={{ gap }}>
          {media.items.map(p => (
            <Phone key={p.src} height={h} ratio={p.r}>
              <img src={p.src} alt={p.alt} />
            </Phone>
          ))}
        </div>
      );
    }
    case "devices":
      return (
        <Devices
          desktop={media.desktop}
          phone={media.phone}
          box={box}
          live={media.live}
          lang={lang}
        />
      );
    case "reels": {
      const gap = 28;
      const marks = media.marks ? 96 : 0;
      const label = 46;
      const h = phoneHeight(
        { w: box.w, h: box.h - marks - label },
        media.ids.length,
        9 / 16,
        gap,
      );
      return (
        <div className="dk-col" style={{ gap: 0 }}>
          <div className="dk-row" style={{ gap, alignItems: "flex-start" }}>
            {media.ids.map(r => (
              <div key={r.id} className="dk-reel">
                <Phone height={h} ratio={9 / 16}>
                  <Wistia id={r.id} on={on} title={t(r.label, "en")} />
                </Phone>
                <span className="dk-small dk-ink2">{t(r.label, lang)}</span>
              </div>
            ))}
          </div>
          {media.marks ? (
            <div className="dk-marks">
              {MARK_ORDER.map(m => (
                <Mark key={m} mark={m} size={56} />
              ))}
            </div>
          ) : null}
        </div>
      );
    }
    case "video": {
      const gap = 32;
      const beside = media.beside;
      if (!beside) {
        const w = Math.min(box.w, (box.h * 16) / 9);
        return (
          <div className="dk-video" style={{ width: w, height: (w * 9) / 16 }}>
            <Wistia id={media.id} on={on} title={media.title} />
          </div>
        );
      }
      if (beside.chat) {
        // The video and the message side by side, the same height.
        const chatW = Math.round(box.w * 0.42);
        const chatH = (chatW - 40) / beside.r + 40 + 46;
        const videoW = Math.min(
          box.w - chatW - gap,
          (Math.min(box.h, chatH) * 16) / 9,
        );
        return (
          <div className="dk-row" style={{ gap }}>
            <div
              className="dk-video"
              style={{ width: videoW, height: (videoW * 9) / 16 }}
            >
              <Wistia id={media.id} on={on} title={media.title} />
            </div>
            <Chat pic={beside} width={chatW} />
          </div>
        );
      }
      const ph = Math.floor(Math.min(box.h, 640));
      const pw = (ph - PHONE_BEZEL * 2) * beside.r + PHONE_BEZEL * 2;
      const videoW = Math.min(box.w - pw - gap, (box.h * 16) / 9);
      return (
        <div className="dk-row" style={{ gap }}>
          <div
            className="dk-video"
            style={{ width: videoW, height: (videoW * 9) / 16 }}
          >
            <Wistia id={media.id} on={on} title={media.title} />
          </div>
          <Phone height={ph} ratio={beside.r}>
            <img src={beside.src} alt={beside.alt} />
          </Phone>
        </div>
      );
    }
    case "stages":
      return (
        <ol className="dk-stages">
          {media.items.map((s, i) => (
            <li key={s.en}>
              <span className="dk-num dk-stage-n">
                {ar(lang) ? "١٢٣٤٥٦"[i] : `0${i + 1}`}
              </span>
              <span className="dk-stage-name">{t(s, lang)}</span>
            </li>
          ))}
        </ol>
      );
    case "call":
      return (
        <div className="dk-call">
          <div className="dk-quote">
            <span className="dk-label" style={{ fontSize: 20 }}>
              {ar(lang) ? "العميل قال" : "The client said"}
            </span>
            <p>{t(media.said, lang)}</p>
          </div>
          <div className="dk-quote" data-us="">
            <span className="dk-label" style={{ fontSize: 20 }}>
              {ar(lang) ? "رد الفريق" : "Our team replied"}
            </span>
            <p>{t(media.replied, lang)}</p>
          </div>
          <div className="dk-audio">
            <Wistia id={media.id} on={on} title="A real call" color="132253" />
          </div>
        </div>
      );
    case "picker":
      return <Picker ctx={ctx} />;
    case "youtube": {
      const gap = 28;
      const caption = 92;
      const cols = 2;
      const rows = Math.ceil(media.items.length / cols);
      const byW = (box.w - gap * (cols - 1)) / cols;
      const byH = (((box.h - gap * (rows - 1)) / rows - caption) * 16) / 9;
      const w = Math.floor(Math.min(byW, byH));
      return (
        <div
          className="dk-yt-grid"
          style={{ gridTemplateColumns: `repeat(${cols}, ${w}px)`, gap }}
        >
          {media.items.map(v => (
            <div key={v.id} className="dk-yt">
              <div
                className="dk-video"
                style={{ width: w, height: (w * 9) / 16 }}
              >
                <YouTube id={v.id} on={on} title={t(v.title, "en")} />
              </div>
              <span className="dk-small dk-ink2" dir="auto">
                {t(v.title, lang)}
              </span>
            </div>
          ))}
        </div>
      );
    }
    case "instagram": {
      // Instagram's own post card: the account, then the reel. The card is
      // cut below the reel, so the lesson shows and the counters do not.
      const gap = 28;
      const label = 50;
      const head = 54;
      const n = media.items.length;
      const byWidth = (box.w - gap * (n - 1)) / n;
      const byHeight = (box.h - label - head) / 1.25;
      const w = Math.floor(Math.min(byWidth, byHeight, 420));
      const h = Math.round(head + w * 1.25);
      return (
        <div className="dk-row" style={{ gap, alignItems: "flex-start" }}>
          {media.items.map(r => (
            <div key={r.code} className="dk-reel">
              <Reel
                code={r.code}
                title={t(r.label, "en")}
                on={on}
                w={w}
                h={h}
              />
              <span className="dk-small dk-ink2">{t(r.label, lang)}</span>
            </div>
          ))}
        </div>
      );
    }
  }
}

/** The market and trade a prospect picks, and the platforms they get. */
function Picker({ ctx }: { ctx: DeckCtx }) {
  const { lang } = ctx;
  const picks = recommend(ctx.service, ctx.market);
  return (
    <div className="dk-picker">
      <div style={{ display: "flex", gap: 16 }}>
        <select
          className="dk-select"
          value={ctx.market}
          onChange={e => ctx.setMarket(e.target.value)}
          aria-label={ar(lang) ? "السوق" : "Market"}
        >
          {MARKETS.map(m => (
            <option key={m.code} value={m.code}>
              {t(m.label, lang)}
            </option>
          ))}
        </select>
        <select
          className="dk-select"
          value={ctx.service}
          onChange={e => ctx.setService(e.target.value)}
          aria-label={ar(lang) ? "الخدمة" : "Trade"}
        >
          {SERVICES.map(s => (
            <option key={s.key} value={s.key}>
              {t(s.label, lang)}
            </option>
          ))}
        </select>
      </div>
      <div className="dk-picks">
        {picks.map((p, i) => (
          <div key={p} className="dk-pick" data-main={i === 0 ? "" : undefined}>
            <Mark mark={PLATFORM_MARK[p]} size={88} />
            <span className="dk-pick-name">{t(PLATFORM_NAMES[p], lang)}</span>
            <span className="dk-label" style={{ fontSize: 20 }}>
              {i === 0
                ? ar(lang)
                  ? "المنصة الأساسية"
                  : "The main platform"
                : ar(lang)
                  ? "تدعمها"
                  : "Alongside it"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The stops of a tour: the name of each, and what the one that is on does. */
function StopList({
  stops,
  at,
  setAt,
  lang,
  label,
}: {
  stops: Stop[];
  at: number;
  setAt: (n: number) => void;
  lang: Lang;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="dk-stops">
      {stops.map((s, i) => (
        <button
          key={s.key}
          type="button"
          role="tab"
          aria-selected={i === at}
          className="dk-stop"
          data-on={i === at ? "" : undefined}
          onClick={() => setAt(i)}
        >
          <span className="dk-stop-name">{t(s.name, lang)}</span>
          {i === at ? (
            <>
              <span className="dk-stop-line">{t(s.what, lang)}</span>
              <span className="dk-why">
                <span className="dk-why-label">{t(WHY, lang)}</span>
                <span>{t(s.why, lang)}</span>
              </span>
            </>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** One stop's real screens, fitted to the stage, and its link to see more. */
function Stage({ stop, ctx, on }: { stop: Stop; ctx: DeckCtx; on: boolean }) {
  return (
    <div key={stop.key} className="dk-stop-media">
      <Fit>
        {box => <StopMedia media={stop.media} ctx={ctx} on={on} box={box} />}
      </Fit>
      {stop.more ? (
        <div className="dk-more">
          <Out href={stop.more.href}>{t(stop.more.label, ctx.lang)}</Out>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A step of the system as a tour: the stops down the start side, the real
 * screens of the stop that is on beside them.
 */
export function tourSlide({
  ctx,
  on,
  label,
  title,
  stops,
  top,
  note,
}: {
  ctx: DeckCtx;
  on: boolean;
  label: string;
  title: string;
  stops: Stop[];
  /** The line that ties this step to the prospect's own challenge. */
  top?: ReactNode;
  /** A line under the stops, from the prospect's own numbers. */
  note?: ReactNode;
}) {
  const { lang, tour, setTour } = ctx;
  const at = Math.max(0, Math.min(tour, stops.length - 1));
  return (
    <>
      {top}
      <div className="dk-tour">
        <div className="dk-tour-side">
          <Rv i={0}>
            <p className="dk-label">{label}</p>
          </Rv>
          <Rv i={1}>
            <h2 className="dk-h2 dk-tour-title">{title}</h2>
          </Rv>
          <Rv i={2} style={{ marginTop: 26 }}>
            <StopList
              stops={stops}
              at={at}
              setAt={setTour}
              lang={lang}
              label={title}
            />
          </Rv>
          {note ? <Rv i={3}>{note}</Rv> : null}
        </div>
        <Rv i={2} className="dk-stage-area">
          <Stage stop={stops[at]} ctx={ctx} on={on} />
        </Rv>
      </div>
    </>
  );
}

/**
 * The lead's journey from the ad to a booked meeting: the steps along a
 * path that fills as → walks it, the step that is on below with its real
 * screens (Aziz: "a screenshot of the landing page, an arrow that goes to
 * the welcome page, an arrow that goes to the call center, an arrow that
 * goes to the thank-you video and the WhatsApp message").
 */
export function journeySlide({
  ctx,
  on,
  label,
  title,
  stops,
  top,
}: {
  ctx: DeckCtx;
  on: boolean;
  label: string;
  title: string;
  stops: Stop[];
  /** The line that ties this step to the prospect's own challenge. */
  top?: ReactNode;
}) {
  const { lang, tour, setTour } = ctx;
  const at = Math.max(0, Math.min(tour, stops.length - 1));
  const stop = stops[at];
  const span = stops.length - 1;
  return (
    <div
      className="dk-col"
      style={{ flex: 1, minHeight: 0, alignItems: "stretch" }}
    >
      {top}
      <Rv i={0}>
        <p className="dk-label">{label}</p>
      </Rv>
      <Rv i={1}>
        <h2 className="dk-h2" style={{ marginTop: 12 }}>
          {title}
        </h2>
      </Rv>
      <Rv i={2}>
        <div role="tablist" aria-label={title} className="dk-path">
          <div className="dk-path-line" aria-hidden />
          <div
            className="dk-path-fill"
            aria-hidden
            style={{ width: `${(at / span) * 100}%` }}
          />
          {stops.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={i === at}
              aria-label={t(s.name, lang)}
              className="dk-path-node"
              data-state={i === at ? "now" : i < at ? "past" : "next"}
              style={{ insetInlineStart: `${(i / span) * 100}%` }}
              onClick={() => setTour(i)}
            >
              <span className="dk-path-dot dk-num">
                {ar(lang) ? "١٢٣٤٥٦"[i] : i + 1}
              </span>
              <span className="dk-path-name">{t(s.short ?? s.name, lang)}</span>
            </button>
          ))}
          {stops.slice(1).map((s, i) => (
            <span
              key={s.key}
              className="dk-path-arrow"
              aria-hidden
              data-lit={i < at ? "" : undefined}
              style={{ insetInlineStart: `${((i + 0.5) / span) * 100}%` }}
            />
          ))}
        </div>
      </Rv>
      <div key={stop.key} className="dk-journey-body">
        <div className="dk-journey-words">
          <p className="dk-h3">{t(stop.name, lang)}</p>
          <p className="dk-body" style={{ color: "var(--dk-ink)" }}>
            {t(stop.what, lang)}
          </p>
          <span className="dk-why">
            <span className="dk-why-label">{t(WHY, lang)}</span>
            <span>{t(stop.why, lang)}</span>
          </span>
          {stop.more ? (
            <Out href={stop.more.href}>{t(stop.more.label, lang)}</Out>
          ) : null}
        </div>
        <div className="dk-stop-media">
          <Fit>
            {box => (
              <StopMedia media={stop.media} ctx={ctx} on={on} box={box} />
            )}
          </Fit>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- the proof

/** The stars Google shows, in Google's own yellow. */
function Stars({ size = 28 }: { size?: number }) {
  return (
    <span className="dk-stars" style={{ fontSize: size }} aria-hidden>
      ★★★★★
    </span>
  );
}

/** Real Google reviews, four to a page, each as Google showed it. */
export function reviewsSlide(page: number) {
  return (ctx: DeckCtx) => {
    const { lang } = ctx;
    const items = REVIEW_PAGES[page];
    const quoted = items.find(r => r.quote);
    return (
      <>
        <Rv i={0}>
          <div className="dk-google-head">
            <Mark mark="google" size={48} />
            <span className="dk-num dk-google-score">
              {ar(lang) ? "٤٫٧" : "4.7"}
            </span>
            <Stars />
            <span className="dk-small">
              {ar(lang)
                ? `من ١٥ تقييم على قوقل · صفحة ${"١٢٣"[page]} من ٣`
                : `from 15 Google reviews · page ${page + 1} of 3`}
            </span>
          </div>
        </Rv>
        <Rv i={1}>
          <h2 className="dk-h2" style={{ marginTop: 18 }}>
            {ar(lang)
              ? "من صفحتنا على قوقل.. بدون أي تعديل."
              : "Straight from our Google profile, untouched."}
          </h2>
        </Rv>
        <Rv i={2} className="dk-reviews">
          {quoted?.quote ? (
            <blockquote className="dk-pull" dir="ltr" lang="en">
              <p>“{quoted.quote}”</p>
              <footer className="dk-small">{quoted.who}, on Google</footer>
            </blockquote>
          ) : null}
          <Fit>
            {box => {
              const rows = justify(
                items.map(r => r.r),
                box.w,
                box.h,
                24,
              );
              return (
                <div className="dk-gallery" style={{ gap: 24 }}>
                  {rows.map(row => (
                    <div
                      key={row.map(p => p.i).join("-")}
                      className="dk-gallery-row"
                      style={{ gap: 24 }}
                    >
                      {row.map(p => (
                        <figure
                          key={items[p.i].src}
                          className="dk-review"
                          style={{ width: p.w, height: p.h }}
                        >
                          <img
                            src={items[p.i].src}
                            alt={`Google review by ${items[p.i].who}`}
                          />
                        </figure>
                      ))}
                    </div>
                  ))}
                </div>
              );
            }}
          </Fit>
        </Rv>
      </>
    );
  };
}

/** The #1 partner page: the approved numbers and every logo. */
export function numberOneSlide(ctx: DeckCtx) {
  const { lang } = ctx;
  return (
    <>
      <Rv i={0}>
        <p className="dk-label">
          {ar(lang) ? "شركاؤنا بالخليج" : "Our partners across the Gulf"}
        </p>
      </Rv>
      <Rv i={1}>
        <h2 className="dk-h1" style={{ marginTop: 16, maxWidth: 1560 }}>
          {ar(lang) ? (
            <>
              الشريك <span className="dk-grad-text">رقم ١</span> لنمو شركات
              التصميم والتنفيذ بالخليج.
            </>
          ) : (
            <>
              The <span className="dk-grad-text">#1</span> growth partner for
              design and build firms in the Gulf.
            </>
          )}
        </h2>
      </Rv>
      <Rv i={2}>
        <div className="dk-n1-stats">
          {NUMBER_ONE.map((m, i) => (
            <div
              key={m.label.en}
              className="dk-n1-stat"
              style={{ "--n": i } as CSSProperties}
            >
              <span className="dk-num dk-n1-value">
                <CountUp value={t(m.value, lang)} delay={300 + i * 140} />
              </span>
              <span className="dk-small">{t(m.label, lang)}</span>
            </div>
          ))}
        </div>
      </Rv>
      <div style={{ flex: 1 }} />
      <Rv i={3}>
        <LogoRiver logos={LOGO_WALL} />
      </Rv>
    </>
  );
}
