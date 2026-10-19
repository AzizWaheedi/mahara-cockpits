import {
  Bell,
  Bookmark,
  ChevronRight,
  Clapperboard,
  Earth,
  Ellipsis,
  Heart,
  House,
  Menu,
  MessageCircle,
  MessageSquare,
  MonitorPlay,
  Search,
  Send,
  Share2,
  SquarePlus,
  Store,
  ThumbsUp,
  Users,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { APP, CTA, type L, type Lang, t } from "../content";
import { type Creative, shapeOf } from "../creative";
import { Logo, type PlatformMark } from "../platforms";
import { Avatar, type Identity } from "./Identity";

/**
 * The customer's phone, drawn plainly (DESIGN 7): the parts of the real
 * Instagram and Facebook screens that tell the client where their ad will
 * be, and nothing invented. No counts, no comments, no dates; "Sponsored"
 * always shows. The screen is laid out in logical units (390u wide), so one
 * layout serves every size, with UI text at 1.25x the real app's.
 */

export const PHONE_BEZEL = 12;
/** The screen's width over its height (390u x 845u). */
export const SCREEN_RATIO = 390 / 845;

/** A phone's width for a height, bezel included. */
export const phoneWidth = (height: number) =>
  (height - PHONE_BEZEL * 2) * SCREEN_RATIO + PHONE_BEZEL * 2;

export function Phone({
  height,
  children,
  label,
}: {
  height: number;
  children: ReactNode;
  /** What the phone shows, for a screen reader. */
  label?: string;
}) {
  const screenH = height - PHONE_BEZEL * 2;
  const screenW = screenH * SCREEN_RATIO;
  return (
    <div
      className="dkc-phone"
      role="img"
      aria-label={label ?? "A phone"}
      style={
        {
          width: screenW + PHONE_BEZEL * 2,
          height,
          "--u": `${screenW / 390}px`,
        } as CSSProperties
      }
    >
      <div className="dkc-phone-screen">{children}</div>
      <i className="dkc-phone-island" aria-hidden />
    </div>
  );
}

/** What every ad mockup needs to draw a creative under the client's name. */
export interface AdProps {
  creative: Creative | null;
  who: Identity;
  pageName: string;
  /** The phone's app language (one per slide, DESIGN 7.1). */
  app: Lang;
  /** The deck's language, for the "Your ad goes here" placeholder. */
  deck: Lang;
  /** Play a video (only the phone in focus does). */
  play?: boolean;
}

const EMPTY: L = { en: "Your ad goes here", ar: "إعلانكم هنا" };

function StatusBar() {
  return (
    <div className="dkc-status-bar" aria-hidden>
      <span>10:24</span>
      <i className="dkc-battery" />
    </div>
  );
}

/** The creative itself, or a quiet block where it will go. */
function Media({
  c,
  deck,
  play,
}: {
  c: Creative | null;
  deck: Lang;
  play?: boolean;
}) {
  if (!c?.url)
    return (
      <span className="dkc-media-empty" dir={deck === "ar" ? "rtl" : "ltr"}>
        {t(EMPTY, deck)}
      </span>
    );
  if (c.video && play)
    return (
      <video
        key={c.id}
        src={c.url}
        poster={c.poster ?? undefined}
        muted
        playsInline
        autoPlay
        preload="metadata"
      />
    );
  const src = c.video ? c.poster : c.url;
  return src ? <img key={c.id} src={src} alt="" draggable={false} /> : null;
}

/** A text the ad carries, in its own direction; grey bars when it has none. */
function Words({
  text,
  lines,
  className,
  lead,
}: {
  text: string | null;
  lines: number;
  className: string;
  lead?: ReactNode;
}) {
  if (!text)
    return (
      <div className="dkc-bars" aria-hidden>
        {Array.from({ length: lines }, (_, i) => (
          <i
            key={String(i)}
            style={{ width: i === lines - 1 ? "58%" : "92%" }}
          />
        ))}
      </div>
    );
  // The caption runs in its own language's direction, the Page name first,
  // as the app sets a caption written in the other language.
  return (
    <div className={className} dir={ARABIC.test(text) ? "rtl" : "ltr"}>
      {lead}
      {lead ? " " : null}
      <span>{text}</span>
    </div>
  );
}

const ARABIC = /[\u0600-\u06FF]/;

const ctaLabel = (c: Creative | null, app: Lang) =>
  t(CTA[c?.cta ?? "LEARN_MORE"], app);

/** Instagram's own bottom tab bar, icons only, so no screen ends in a void. */
function IgTabs() {
  return (
    <div className="dkc-tabbar" aria-hidden>
      <House />
      <Search />
      <SquarePlus />
      <Clapperboard />
      <i className="dkc-tabbar-av" />
    </div>
  );
}

/** Instagram feed, dark (DESIGN 7.2). */
export function IgFeed({ creative, who, pageName, app, deck, play }: AdProps) {
  const square = shapeOf(creative?.ratio) === "1:1";
  return (
    <div className="dkc-app" data-app="ig" dir={app === "ar" ? "rtl" : "ltr"}>
      <StatusBar />
      <div className="dkc-ad-head">
        <Avatar who={who} size="calc(var(--u) * 34)" />
        <div className="dkc-ad-who">
          <b dir="auto">{pageName}</b>
          <span>{t(APP.sponsored, app)}</span>
        </div>
        <Ellipsis />
      </div>
      <div
        className="dkc-media"
        style={{ aspectRatio: square ? "1 / 1" : "4 / 5" }}
      >
        <Media c={creative} deck={deck} play={play} />
      </div>
      <div className="dkc-cta-bar">
        <span>{ctaLabel(creative, app)}</span>
        <ChevronRight />
      </div>
      <div className="dkc-actions" aria-hidden>
        <Heart />
        <MessageCircle />
        <Send />
        <Bookmark />
      </div>
      <Words
        text={creative?.primaryText ?? null}
        lines={2}
        className="dkc-caption-text"
        lead={<b>{pageName}</b>}
      />
      <IgTabs />
    </div>
  );
}

/** Instagram Reels and Stories, one 9:16 frame (DESIGN 7.3). */
export function ReelStory({
  creative,
  who,
  pageName,
  app,
  deck,
  play,
}: AdProps) {
  const tall = shapeOf(creative?.ratio) === "9:16" || !creative?.ratio;
  const still = creative
    ? creative.video
      ? creative.poster
      : creative.url
    : null;
  return (
    <div className="dkc-app" data-app="ig" dir={app === "ar" ? "rtl" : "ltr"}>
      <div className="dkc-reel">
        {creative?.url ? (
          <>
            {!tall && still ? (
              <img className="dkc-reel-blur" src={still} alt="" aria-hidden />
            ) : null}
            <div
              className="dkc-reel-media"
              data-fit={tall ? "cover" : "contain"}
            >
              <Media c={creative} deck={deck} play={play} />
            </div>
          </>
        ) : (
          <div className="dkc-media" style={{ position: "absolute", inset: 0 }}>
            <Media c={null} deck={deck} />
          </div>
        )}
        <div className="dkc-reel-top">
          <StatusBar />
        </div>
        <div className="dkc-reel-rail" aria-hidden>
          <Heart />
          <MessageCircle />
          <Send />
          <Ellipsis />
        </div>
        <div className="dkc-reel-foot">
          <div className="dkc-reel-who">
            <Avatar who={who} size="calc(var(--u) * 32)" />
            <div>
              <b dir="auto">{pageName}</b>
              <br />
              <span>{t(APP.sponsored, app)}</span>
            </div>
          </div>
          {creative?.primaryText ? (
            <div className="dkc-reel-cap" dir="auto">
              {creative.primaryText}
            </div>
          ) : (
            <div className="dkc-bars" style={{ padding: 0 }} aria-hidden>
              <i style={{ width: "78%" }} />
            </div>
          )}
          <div className="dkc-reel-cta">
            <span>{ctaLabel(creative, app)}</span>
            <ChevronRight />
          </div>
        </div>
        <IgTabs />
      </div>
    </div>
  );
}

/** Facebook feed, dark (DESIGN 7.4). */
export function FbFeed({ creative, who, pageName, app, deck, play }: AdProps) {
  const square = shapeOf(creative?.ratio) === "1:1";
  return (
    <div className="dkc-app" data-app="fb" dir={app === "ar" ? "rtl" : "ltr"}>
      <StatusBar />
      <div className="dkc-ad-head" style={{ height: "calc(var(--u) * 60)" }}>
        <Avatar who={who} size="calc(var(--u) * 40)" />
        <div className="dkc-ad-who">
          <b dir="auto">{pageName}</b>
          <span>
            {t(APP.sponsored, app)} ·{" "}
            <Earth
              style={{ width: "1em", height: "1em", verticalAlign: "-0.1em" }}
            />
          </span>
        </div>
        <Ellipsis />
      </div>
      <Words
        text={creative?.primaryText ?? null}
        lines={3}
        className="dkc-fb-text"
      />
      <div
        className="dkc-media"
        style={{ aspectRatio: square ? "1 / 1" : "4 / 5" }}
      >
        <Media c={creative} deck={deck} play={play} />
      </div>
      <div className="dkc-fb-link">
        <div>
          {creative?.headline ? (
            <b dir="auto">{creative.headline}</b>
          ) : (
            <div className="dkc-bars" style={{ padding: 0 }} aria-hidden>
              <i style={{ width: "80%" }} />
            </div>
          )}
        </div>
        <span className="dkc-fb-cta">{ctaLabel(creative, app)}</span>
      </div>
      <div className="dkc-fb-actions" aria-hidden>
        <span>
          <ThumbsUp />
          {t(APP.like, app)}
        </span>
        <span>
          <MessageSquare />
          {t(APP.comment, app)}
        </span>
        <span>
          <Share2 />
          {t(APP.share, app)}
        </span>
      </div>
      <div className="dkc-tabbar" aria-hidden>
        <House />
        <MonitorPlay />
        <Users />
        <Store />
        <Bell />
        <Menu />
      </div>
    </div>
  );
}

/**
 * A phone with what it is under it and, above its end corner, the tag that
 * says what kind of picture it is (DESIGN 5.4): outside the frame, never on
 * the status bar.
 */
export function PhoneFigure({
  height,
  mark,
  label,
  tag,
  wide = false,
  children,
}: {
  height: number;
  mark: PlatformMark;
  label: string;
  tag?: string | null;
  /** The tag may run wider than the phone, toward the start (end-aligned). */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <figure
      className="dkc-figure"
      style={{ margin: 0, width: wide ? undefined : phoneWidth(height) }}
    >
      <div className="dkc-figure-head">
        {tag ? <span className="dk-tag">{tag}</span> : null}
      </div>
      <Phone height={height} label={label}>
        {children}
      </Phone>
      <figcaption
        className="dkc-figure-foot dk-label"
        style={wide ? { width: phoneWidth(height) } : undefined}
      >
        <Logo mark={mark} size={30} />
        {label}
      </figcaption>
    </figure>
  );
}
