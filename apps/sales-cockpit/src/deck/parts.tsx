import { type CSSProperties, type ReactNode, useState } from "react";
import { type Faq, type Lang, PILLARS, type PillarKey, t } from "./content";

/**
 * The pieces every slide shares: the entrance order, the labels, the video
 * players (loaded only while their slide is on screen, so eight Wistia
 * players never load at once), the pipeline rail and the questions panel.
 */

/** A block that enters in order when its slide comes up. */
export function Rv({
  i = 0,
  children,
  className = "",
  style,
}: {
  i?: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`dk-rv ${className}`}
      style={{ ...style, ["--i" as string]: i } as CSSProperties}
    >
      {children}
    </div>
  );
}

export function Wistia({
  id,
  on,
  title,
  color = "00CFC8",
}: {
  id: string;
  /** Only the slide on screen loads its player. */
  on: boolean;
  title: string;
  /** The player's colour; an audio player is all colour, so it takes a quiet one. */
  color?: string;
}) {
  // `allow` already grants full screen; allowFullScreen beside it only
  // earns a console warning.
  return on ? (
    <iframe
      src={`https://fast.wistia.net/embed/iframe/${id}?seo=false&playerColor=${color}&fullscreenButton=true`}
      title={title}
      allow="autoplay; fullscreen"
    />
  ) : (
    <div className="dk-video-poster" />
  );
}

/** A YouTube video's own cover picture, the full-size one. */
export const youtubePoster = (id: string, size = "maxresdefault") =>
  `https://i.ytimg.com/vi/${id}/${size}.jpg`;

/**
 * A YouTube video as its cover with the deck's own play mark (the teal of
 * the Wistia players on every other slide); a click starts the player in
 * place. The cover is there at once, where a player takes seconds of black
 * and then lays YouTube's title, channel and "Watch on YouTube" over the
 * picture, under a caption that already says the title.
 */
export function YouTube({
  id,
  on,
  title,
}: {
  id: string;
  on: boolean;
  title: string;
}) {
  const [playing, setPlaying] = useState(false);
  if (!on) return <div className="dk-video-poster" />;
  if (playing)
    return (
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&autoplay=1`}
        title={title}
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      />
    );
  return (
    <button
      type="button"
      className="dk-yt-cover"
      onClick={() => setPlaying(true)}
      aria-label={`${title}. Play`}
    >
      <img
        src={youtubePoster(id)}
        alt=""
        draggable={false}
        // An older video may have no full-size cover: YouTube then sends a
        // 120 px grey stand-in, or nothing; take the smaller cover instead.
        onLoad={e => {
          const img = e.currentTarget;
          if (img.naturalWidth <= 120 && !img.src.includes("hqdefault"))
            img.src = youtubePoster(id, "hqdefault");
        }}
        onError={e => {
          const img = e.currentTarget;
          if (!img.src.includes("hqdefault"))
            img.src = youtubePoster(id, "hqdefault");
        }}
      />
      <span className="dk-play" aria-hidden>
        <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden>
          <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
        </svg>
      </span>
    </button>
  );
}

/** An outside link that opens beside the deck, never over it. */
export function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="dk-link"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
      <span aria-hidden className="dk-ltr">
        ↗
      </span>
    </a>
  );
}

/**
 * The pipeline rail: the five steps of the system along the foot of every
 * slide. The step a slide is about is lit, the ones before it are passed,
 * and the steps that answer the prospect's chosen problem carry a ring.
 */
export function Rail({
  lang,
  now,
  all,
  match,
}: {
  lang: Lang;
  /** The pillar this slide is about. */
  now: PillarKey | null;
  /** Every step lit (the system slide, the program). */
  all?: boolean;
  match: PillarKey[];
}) {
  const at = now ? PILLARS.findIndex(p => p.key === now) : -1;
  const span = PILLARS.length - 1;
  const fill = all ? 100 : at < 0 ? 0 : (at / span) * 100;
  return (
    <div className="dk-rail" aria-hidden>
      <div className="dk-rail-line" />
      <div className="dk-rail-fill" style={{ width: `${fill}%` }} />
      {PILLARS.map((p, i) => {
        const state = all
          ? "past"
          : i === at
            ? "now"
            : i < at
              ? "past"
              : "next";
        const pos = `${(i / span) * 100}%`;
        return (
          <div key={p.key}>
            <div
              className="dk-node"
              data-state={state}
              data-match={match.includes(p.key) ? "" : undefined}
              style={{ insetInlineStart: pos }}
            />
            <div
              className="dk-node-label"
              data-state={state}
              style={{ insetInlineStart: pos }}
            >
              {t(p.short, lang)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The questions a prospect asks at this step, opened with "?" or Q. */
export function FaqPanel({
  lang,
  title,
  faqs,
  onClose,
}: {
  lang: Lang;
  title: string;
  faqs: Faq[];
  onClose: () => void;
}) {
  return (
    <aside className="dk-panel" aria-label={title}>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <p className="dk-label" style={{ flex: 1 }}>
          {title}
        </p>
        <button
          type="button"
          className="dk-btn dk-quiet"
          style={{ height: 56, padding: "0 22px" }}
          onClick={onClose}
        >
          {lang === "ar" ? "سكّر" : "Close"}
        </button>
      </div>
      <div
        style={{
          marginTop: 40,
          display: "flex",
          flexDirection: "column",
          gap: 36,
        }}
      >
        {faqs.map(f => (
          <div key={f.q.en} className="dk-hair" style={{ paddingTop: 28 }}>
            <p className="dk-h3" style={{ fontSize: lang === "ar" ? 34 : 32 }}>
              {t(f.q, lang)}
            </p>
            <p className="dk-body" style={{ marginTop: 14 }}>
              {t(f.a, lang)}
            </p>
          </div>
        ))}
      </div>
    </aside>
  );
}
