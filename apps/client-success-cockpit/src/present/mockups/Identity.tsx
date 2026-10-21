import { useEffect, useState } from "react";

/**
 * The client's mark, wherever the deck shows it (DESIGN 7.1, 7.7). Logos
 * exist for few clients, so the monogram is the deck's normal look and is
 * designed as one, never a broken image or an empty circle. The logo is
 * theirs, so it never takes a teal ring: on a deck surface it sits on a
 * plain plate, inside an app it is a plain circle.
 */

export interface Identity {
  name: string;
  initials: string;
  logo: { url: string } | null;
}

const ARABIC = /[؀-ۿ]/;

/** The plate a logo needs: ink behind a dark logo, deep behind a light one. */
export type Ground = "ink" | "deep";

const grounds = new Map<string, Ground>();

/**
 * Reads a logo's average brightness once (its opaque pixels only) to pick
 * its plate. A logo the browser will not read (no CORS) keeps the ink plate,
 * which suits most logos, drawn dark on a light ground.
 */
export function useLogoGround(url: string | null | undefined): Ground {
  const [ground, setGround] = useState<Ground>(() =>
    url ? (grounds.get(url) ?? "ink") : "ink",
  );
  useEffect(() => {
    if (!url) return;
    const known = grounds.get(url);
    if (known) {
      setGround(known);
      return;
    }
    let live = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 48;
        c.height = 48;
        const g = c.getContext("2d", { willReadFrequently: true });
        if (!g) return;
        g.drawImage(img, 0, 0, 48, 48);
        const px = g.getImageData(0, 0, 48, 48).data;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3] / 255;
          if (a < 0.2) continue;
          sum +=
            (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
          n++;
        }
        // A logo with a light ground of its own (no transparency) reads as
        // light too; the deep plate then frames it.
        const out: Ground = n && sum / n > 0.62 ? "deep" : "ink";
        grounds.set(url, out);
        if (live) setGround(out);
      } catch {
        grounds.set(url, "ink");
      }
    };
    img.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return ground;
}

/** The one letter a monogram shows: the first of the initials (DESIGN 22.5.1). */
export const monogramLetter = (initials: string) =>
  Array.from(initials.trim())[0] ?? "";

/**
 * No logo, on a deck surface (DESIGN 22.5.1): a rounded-square tile, never
 * a circle (a circle with initials reads as a missing avatar; a tile reads
 * as a mark, the way an app icon does). One letter, upper case, at half the
 * tile, on panel-2 with a 1 px inset edge. Never teal, never a ring.
 */
export function Monogram({
  initials,
  size,
}: {
  initials: string;
  size: number;
}) {
  const letter = monogramLetter(initials);
  const ar = ARABIC.test(letter);
  return (
    <span
      className="dkc-monogram"
      data-ar={ar ? "" : undefined}
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        fontSize: size * (ar ? 0.46 : 0.5),
      }}
    >
      <span className="dkc-monogram-letter">{letter || "·"}</span>
    </span>
  );
}

/** The client's logo on its plate, or the monogram (a deck surface). */
export function ClientMark({ who, size }: { who: Identity; size: number }) {
  const ground = useLogoGround(who.logo?.url);
  const [broken, setBroken] = useState(false);
  if (!who.logo || broken)
    return <Monogram initials={who.initials} size={size} />;
  return (
    <span
      className="dkc-plate"
      data-ground={ground}
      style={{ width: size, height: size }}
    >
      <img
        src={who.logo.url}
        alt={who.name}
        draggable={false}
        onError={() => setBroken(true)}
      />
    </span>
  );
}

/** The avatar inside app chrome: a plain circle, logo or monogram. */
export function Avatar({ who, size }: { who: Identity; size: string }) {
  const ground = useLogoGround(who.logo?.url);
  const [broken, setBroken] = useState(false);
  // Inside app chrome a profile picture is a circle: the same one letter
  // on the app's own avatar ground (DESIGN 22.5.1).
  if (!who.logo || broken) {
    const letter = monogramLetter(who.initials);
    return (
      <span
        className="dkc-avatar dkc-avatar-letter"
        data-ar={ARABIC.test(letter) ? "" : undefined}
        aria-hidden
        style={{
          width: size,
          height: size,
          fontSize: `calc(${size} * 0.46)`,
        }}
      >
        {letter || "·"}
      </span>
    );
  }
  return (
    <span
      className="dkc-avatar dkc-plate"
      data-ground={ground}
      style={{ width: size, height: size }}
    >
      <img
        src={who.logo.url}
        alt=""
        draggable={false}
        onError={() => setBroken(true)}
      />
    </span>
  );
}
