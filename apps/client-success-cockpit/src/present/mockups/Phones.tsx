import {
  Bell,
  Bookmark,
  ChevronRight,
  Clapperboard,
  Earth,
  Ellipsis,
  Heart,
  House,
  Image as ImageIcon,
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
import { APP, CTA, type Lang, t } from "../content";
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
  progress,
}: {
  height: number;
  children: ReactNode;
  /** What the phone shows, for a screen reader. */
  label?: string;
  /**
   * A file saving behind the preview (DESIGN 10.3): a 4 px teal bar grows
   * along the screen's foot, then fades. No words on the share.
   */
  progress?: number | null;
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
      <div className="dkc-phone-screen">
        {children}
        {progress != null ? (
          <i
            className="dkc-phone-progress"
            data-done={progress >= 1 ? "" : undefined}
            style={{ transform: `scaleX(${Math.max(0.02, progress)})` }}
            aria-hidden
          />
        ) : null}
      </div>
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
  /** The deck's language. */
  deck: Lang;
  /** Play a video (only the phone in focus does). */
  play?: boolean;
}

function StatusBar() {
  return (
    <div className="dkc-status-bar" aria-hidden>
      <span>10:24</span>
      <i className="dkc-battery" />
    </div>
  );
}

/**
 * The creative itself or, before there is one, the client's own brand card
 * on the picture's ground: their mark and their name set as a card would
 * carry them, never a "your ad goes here" placeholder and never a bare
 * monogram in an empty square.
 */
function Media({
  c,
  who,
  play,
}: {
  c: Creative | null;
  who: Identity;
  play?: boolean;
}) {
  if (!c?.url)
    return (
      <span className="dkc-media-empty dkc-media-mark" aria-hidden>
        <Avatar who={who} size="calc(var(--u) * 92)" />
        <b dir="auto">{who.name}</b>
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
  // An example ad's picture drifts once, slowly (DESIGN 22.14); theirs never.
  return src ? (
    <img
      key={c.id}
      src={src}
      alt=""
      draggable={false}
      data-example={c.from === "example" ? "" : undefined}
    />
  ) : null;
}

/**
 * A text the ad carries, in its own direction. With none, nothing is drawn
 * and nothing is invented (DESIGN 8.3): the Instagram caption keeps only the
 * Page name, as the app shows an ad with no primary text.
 */
function Words({
  text,
  className,
  lead,
}: {
  text: string | null;
  className: string;
  lead?: ReactNode;
}) {
  if (!text)
    return lead ? (
      <div className={className} dir="auto">
        {lead}
      </div>
    ) : null;
  // The caption runs in its own language's direction, the Page name first,
  // as the app sets a caption written in the other language. The text sits
  // in its own isolate too: a caption is the client's, in either script.
  return (
    <div
      className={className}
      dir={ARABIC.test(text) ? "rtl" : "ltr"}
      data-part="words"
    >
      {lead}
      {lead ? " " : null}
      <span dir="auto">{text}</span>
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
export function IgFeed({ creative, who, pageName, app, play }: AdProps) {
  const square = shapeOf(creative?.ratio) === "1:1";
  return (
    <div className="dkc-app" data-app="ig" dir={app === "ar" ? "rtl" : "ltr"}>
      <StatusBar />
      <div className="dkc-ad-head">
        <span data-part="who">
          <Avatar who={who} size="calc(var(--u) * 34)" />
        </span>
        <div className="dkc-ad-who">
          <b dir="auto">{pageName}</b>
          <span data-part="sponsored">{t(APP.sponsored, app)}</span>
        </div>
        <Ellipsis />
      </div>
      <div
        className="dkc-media"
        data-part="media"
        style={{ aspectRatio: square ? "1 / 1" : "4 / 5" }}
      >
        <Media c={creative} who={who} play={play} />
      </div>
      <div className="dkc-cta-bar" data-part="cta">
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
        className="dkc-caption-text"
        // Isolated: a Latin Page name inside an Arabic caption ("Al Reem …
        // Co.") kept its full stop at its start without it (score round 3).
        lead={<b dir="auto">{pageName}</b>}
      />
      {/* No caption: the feed carries on with the next post's head and the
          top of its picture, cut by the tab bar (score round 4: a black
          band stood between the Page name and the tabs). */}
      {creative?.primaryText ? null : (
        <div className="dkc-next-post" aria-hidden>
          <span className="dkc-next-post-head">
            <i />
            <b />
          </span>
          <span className="dkc-next-post-media" />
        </div>
      )}
      <IgTabs />
    </div>
  );
}

/** Instagram Reels and Stories, one 9:16 frame (DESIGN 7.3). */
export function ReelStory({ creative, who, pageName, app, play }: AdProps) {
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
              data-part="media"
              data-fit={tall ? "cover" : "contain"}
            >
              <Media c={creative} who={who} play={play} />
            </div>
          </>
        ) : (
          <div
            className="dkc-media"
            data-part="media"
            style={{ position: "absolute", inset: 0 }}
          >
            <Media c={null} who={who} />
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
            <span data-part="who">
              <Avatar who={who} size="calc(var(--u) * 32)" />
            </span>
            <div>
              <b dir="auto">{pageName}</b>
              <br />
              <span data-part="sponsored">{t(APP.sponsored, app)}</span>
            </div>
          </div>
          {creative?.primaryText ? (
            <div className="dkc-reel-cap" dir="auto" data-part="words">
              {creative.primaryText}
            </div>
          ) : null}
          <div className="dkc-reel-cta" data-part="cta">
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
export function FbFeed({ creative, who, pageName, app, play }: AdProps) {
  const square = shapeOf(creative?.ratio) === "1:1";
  return (
    <div className="dkc-app" data-app="fb" dir={app === "ar" ? "rtl" : "ltr"}>
      <StatusBar />
      {/* Facebook's own first row of the feed (the viewer's composer, the
          viewer drawn as a plain circle), then its gap: the ad is the post
          under it, as the app shows one near the top of the feed. */}
      <div className="dkc-fb-composer" aria-hidden>
        <i className="dkc-fb-me" />
        <span>{t(APP.composer, app)}</span>
        <ImageIcon />
      </div>
      <i className="dkc-fb-gap" aria-hidden />
      <div className="dkc-ad-head" style={{ height: "calc(var(--u) * 60)" }}>
        <span data-part="who">
          <Avatar who={who} size="calc(var(--u) * 40)" />
        </span>
        <div className="dkc-ad-who">
          <b dir="auto">{pageName}</b>
          <span className="dkc-fb-sponsored" data-part="sponsored">
            {t(APP.sponsored, app)} ·
            <Earth aria-hidden />
          </span>
        </div>
        <Ellipsis />
      </div>
      <Words text={creative?.primaryText ?? null} className="dkc-fb-text" />
      <div
        className="dkc-media"
        data-part="media"
        style={{ aspectRatio: square ? "1 / 1" : "4 / 5" }}
      >
        <Media c={creative} who={who} play={play} />
      </div>
      <div className="dkc-fb-link">
        {/* No headline, no slot: the button keeps its place at the end. An
            example with no service to name carries their Page name there
            (their own words), so its bar is never a blank strip (the
            fixer's round). */}
        <div>
          {creative?.headline ? (
            <b dir="auto">{creative.headline}</b>
          ) : creative?.from === "example" ? (
            <b dir="auto">{pageName}</b>
          ) : null}
        </div>
        <span className="dkc-fb-cta" data-part="cta">
          {ctaLabel(creative, app)}
        </span>
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
      {/* Where the post ends: Facebook's gap between posts, nothing after it. */}
      <i className="dkc-fb-gap" aria-hidden />
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
 * the status bar. On a cover the tag hangs under the phone's foot instead
 * (`tagBelow`, score round 2): over it, it stacked under the presenter's
 * name and role as a third line.
 */
export function PhoneFigure({
  height,
  mark,
  label,
  tag,
  tagBelow = false,
  wide = false,
  head = true,
  foot = true,
  progress,
  children,
}: {
  height: number;
  mark: PlatformMark;
  label: string;
  tag?: string | null;
  /**
   * The tag 24 px under the phone, end-aligned, out of the figure's flow, so
   * the figure's box is the phone's and it centres on it (the covers).
   */
  tagBelow?: boolean;
  /** The tag may run wider than the phone, toward the start (end-aligned). */
  wide?: boolean;
  /** Leave room above for a tag (off where the slide tags the picture once). */
  head?: boolean;
  /** The platform mark and the placement's name under the phone. */
  foot?: boolean;
  progress?: number | null;
  children: ReactNode;
}) {
  return (
    <figure
      className="dkc-figure"
      data-tag-below={tagBelow ? "" : undefined}
      style={{ margin: 0, width: wide ? undefined : phoneWidth(height) }}
    >
      {head && !tagBelow ? (
        <div className="dkc-figure-head">
          {tag ? <span className="dk-tag">{tag}</span> : null}
        </div>
      ) : null}
      <Phone height={height} label={label} progress={progress}>
        {children}
      </Phone>
      {tagBelow && tag ? (
        <span className="dk-tag dkc-figure-tag-below">{tag}</span>
      ) : null}
      {foot ? (
        <figcaption
          className="dkc-figure-foot dk-label"
          style={wide ? { width: phoneWidth(height) } : undefined}
        >
          <Logo mark={mark} size={30} />
          {label}
        </figcaption>
      ) : null}
    </figure>
  );
}
