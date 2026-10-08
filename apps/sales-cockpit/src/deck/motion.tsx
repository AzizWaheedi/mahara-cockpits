import { type CSSProperties, useEffect, useState } from "react";
import { figure } from "./figure";

/**
 * The #1 page's motion (Aziz, 2026-10-08: "have the logos move and add some
 * smooth animations"): the four figures count up once as the page comes on,
 * and the partners' logos drift past in two lanes, one each way. With
 * reduced motion the figures stand at their values and the logos stand
 * still as a grid.
 */

const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** How long one figure takes to count up, in ms. */
const COUNT_MS = 1500;

/**
 * A figure that counts up from zero once, `delay` ms after its page comes
 * on (only the page on screen is mounted). The final figure, unseen, holds
 * the width so nothing beside it moves while it counts.
 */
export function CountUp({ value, delay }: { value: string; delay: number }) {
  const [shown, setShown] = useState(() =>
    reduced() ? value : (figure(value)?.at(0) ?? value),
  );
  useEffect(() => {
    const f = figure(value);
    if (!f || reduced()) {
      setShown(value);
      return;
    }
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      start ||= now;
      const p = Math.min(1, (now - start) / COUNT_MS);
      // Fast, then settling into the figure (ease-out quart).
      setShown(f.at(p >= 1 ? 1 : 1 - (1 - p) ** 4));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    const wait = window.setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      window.clearTimeout(wait);
      cancelAnimationFrame(raf);
    };
  }, [value, delay]);
  return (
    <span className="dk-tally">
      <span className="dk-tally-hold" aria-hidden>
        {value}
      </span>
      <span className="dk-tally-live">{shown}</span>
    </span>
  );
}

export interface PartnerLogo {
  src: string;
  name: string;
}

/** The box a logo may fill inside its tile, in canvas px. */
const BOX_W = 192;
const BOX_H = 82;
/** The ink every logo gets, so a long wordmark and a round badge weigh the same. */
const AREA = 8800;

/**
 * Sizes a logo by its area rather than its box: a square badge would
 * otherwise tower over a wide wordmark. Written as shares of the tile's
 * box, so the smaller still grid keeps the same balance.
 */
function weigh(img: HTMLImageElement | null) {
  if (!img?.naturalWidth || !img.naturalHeight) return;
  const r = img.naturalWidth / img.naturalHeight;
  let h = Math.min(BOX_H, Math.sqrt(AREA / r));
  let w = h * r;
  if (w > BOX_W) {
    w = BOX_W;
    h = w / r;
  }
  img.style.width = `${((w / BOX_W) * 100).toFixed(1)}%`;
  img.style.height = `${((h / BOX_H) * 100).toFixed(1)}%`;
}

/** A partner's logo on its tile; the second copy in a lane is for the loop only. */
function Tile({ logo, copy }: { logo: PartnerLogo; copy: boolean }) {
  return (
    <span
      className="dk-tile"
      title={copy ? undefined : logo.name}
      aria-hidden={copy || undefined}
      data-copy={copy ? "" : undefined}
    >
      <img
        ref={img => {
          if (img?.complete) weigh(img);
        }}
        src={logo.src}
        alt={copy ? "" : logo.name}
        draggable={false}
        onLoad={e => weigh(e.currentTarget)}
      />
    </span>
  );
}

/** Seconds a lane takes per logo: about 48 canvas px a second, calm. */
const SECONDS_PER_LOGO = 4.8;

/**
 * Every partner's logo in two lanes drifting opposite ways, each lane the
 * set twice over and moved by exactly half, so the loop has no seam. A lane
 * stops while the pointer is on it; the logo under it lifts.
 */
export function LogoRiver({ logos }: { logos: PartnerLogo[] }) {
  const half = Math.ceil(logos.length / 2);
  const lanes = [logos.slice(0, half), logos.slice(half)];
  return (
    <div className="dk-river">
      {lanes.map((lane, i) => (
        <div
          key={lane[0]?.name ?? i}
          className="dk-lane"
          data-way={i === 0 ? "start" : "end"}
          style={
            {
              "--dk-loop": `${(lane.length * SECONDS_PER_LOGO).toFixed(1)}s`,
            } as CSSProperties
          }
        >
          <div className="dk-lane-track">
            {[...lane, ...lane].map((logo, k) => (
              <Tile
                key={`${logo.name}-${k < lane.length ? "a" : "b"}`}
                logo={logo}
                copy={k >= lane.length}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
