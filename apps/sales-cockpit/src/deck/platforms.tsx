import type { CSSProperties } from "react";
import facebook from "./assets/brands/facebook.webp";
import google from "./assets/brands/google.webp";
import instagram from "./assets/brands/instagram.webp";
import meta from "./assets/brands/meta.webp";
import snapchat from "./assets/brands/snapchat.webp";
import tiktok from "./assets/brands/tiktok.webp";
import whatsapp from "./assets/brands/whatsapp.webp";
import youtube from "./assets/brands/youtube.webp";

/**
 * The platforms a prospect's ads and leads run through, each in its own
 * official full-colour logo (Aziz, 2026-10-08: "use all the real logos ...
 * so they look like the platform logos with their colors"). The files are
 * the brands' own artwork, rendered to 256 px webp with a transparent
 * ground and never recoloured (nominative use):
 *
 *   instagram  Instagram app icon, 2022 gradient
 *              https://commons.wikimedia.org/wiki/File:Instagram_logo_2022.svg
 *   tiktok     TikTok icon, black square, from TikTok's own logo pack
 *              https://developers.tiktok.com/doc/getting-started-design-guidelines
 *              (https://sf16-va.tiktokcdn.com/obj/eden-va2/uvzhqeh7nuhd/tt4d/logo-pack.zip,
 *              TikTok_Icon_Black_Square.png)
 *   snapchat   Ghost logo on Snapchat Yellow
 *              https://en.wikipedia.org/wiki/File:Snapchat_logo.svg
 *   facebook   Facebook "f" logo, 2023 blue
 *              https://commons.wikimedia.org/wiki/File:2023_Facebook_icon.svg
 *   youtube    YouTube full-colour icon
 *              https://commons.wikimedia.org/wiki/File:YouTube_full-color_icon_(2017).svg
 *   google     Google "G", four colours
 *              https://commons.wikimedia.org/wiki/File:Google_%22G%22_logo.svg
 *   whatsapp   WhatsApp logo
 *              https://commons.wikimedia.org/wiki/File:WhatsApp.svg
 *   meta       Meta symbol
 *              https://commons.wikimedia.org/wiki/File:Meta_Platforms_Inc._logo_(cropped).svg
 *
 * A badge shows each mark the way a phone's home screen does: the brands
 * whose logo is itself an app tile (Instagram, TikTok, Snapchat) fill it;
 * the rest sit on a white tile, the ground their logos are drawn for.
 */
export type PlatformMark =
  | "instagram"
  | "tiktok"
  | "snapchat"
  | "facebook"
  | "youtube"
  | "google"
  | "whatsapp"
  | "meta";

interface MarkArt {
  name: string;
  src: string;
  /** The logo is its own tile; otherwise it sits on white at this share of the tile. */
  fit: number | "tile";
}

const MARKS: Record<PlatformMark, MarkArt> = {
  instagram: { name: "Instagram", src: instagram, fit: "tile" },
  tiktok: { name: "TikTok", src: tiktok, fit: "tile" },
  snapchat: { name: "Snapchat", src: snapchat, fit: "tile" },
  facebook: { name: "Facebook", src: facebook, fit: 0.64 },
  youtube: { name: "YouTube", src: youtube, fit: 0.66 },
  google: { name: "Google", src: google, fit: 0.56 },
  whatsapp: { name: "WhatsApp", src: whatsapp, fit: 0.66 },
  meta: { name: "Meta", src: meta, fit: 0.68 },
};

/** Every platform the ads run on, in the order the deck shows them. */
export const MARK_ORDER: PlatformMark[] = [
  "instagram",
  "tiktok",
  "snapchat",
  "facebook",
  "youtube",
  "google",
];

/** One platform's logo as an app tile. */
export function Mark({
  mark,
  size = 72,
  style,
}: {
  mark: PlatformMark;
  size?: number;
  style?: CSSProperties;
}) {
  const m = MARKS[mark];
  const share = m.fit === "tile" ? null : `${m.fit * 100}%`;
  return (
    <span
      className="dk-mark"
      data-ground={share ? "white" : "own"}
      title={m.name}
      style={{ width: size, height: size, ...style }}
    >
      <img
        src={m.src}
        alt={m.name}
        draggable={false}
        style={share ? { width: share, height: share } : undefined}
      />
    </span>
  );
}

/** One platform's logo on its own, no tile (inside a frame that is already that platform). */
export function Logo({
  mark,
  size = 24,
}: {
  mark: PlatformMark;
  size?: number;
}) {
  const m = MARKS[mark];
  return (
    <img
      className="dk-logo"
      src={m.src}
      alt=""
      aria-hidden
      draggable={false}
      width={size}
      height={size}
      // Inline, so a frame's own rule for its pictures cannot stretch it.
      style={{ width: size, height: size, borderRadius: 0 }}
    />
  );
}
