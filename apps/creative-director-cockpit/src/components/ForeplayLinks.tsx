import {
  ArrowUpRight,
  Compass,
  Layers,
  Radar,
  Smartphone,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

/**
 * Where to go in Foreplay when the board here has nothing for you.
 *
 * Their app cannot be embedded: foreplay.co answers with
 * `frame-ancestors 'self'`, so an iframe of discovery renders an empty box.
 * A link is the whole of what is possible, and it is enough -- everyone on
 * the team is signed in there, so it lands on the real page.
 *
 * The paths are their router's own, read off app.foreplay.co's bundle on
 * 2026-09-19 rather than guessed. Their word for the swipe file is
 * "library". The same row is on the video editor's ideation page, so the
 * three cockpits hand off to the same places.
 */
const APP = "https://app.foreplay.co";

const LINKS: [string, string, ReactNode][] = [
  [
    "Search discovery",
    `${APP}/discovery`,
    <Compass key="i" className="h-3.5 w-3.5" />,
  ],
  [
    "By advertiser",
    `${APP}/discovery-brands`,
    <Users key="i" className="h-3.5 w-3.5" />,
  ],
  [
    "Brands we follow",
    `${APP}/spyder`,
    <Radar key="i" className="h-3.5 w-3.5" />,
  ],
  ["Boards", `${APP}/boards`, <Layers key="i" className="h-3.5 w-3.5" />],
  [
    "Save from your phone",
    `${APP}/library-mobile-saving`,
    <Smartphone key="i" className="h-3.5 w-3.5" />,
  ],
];

export default function ForeplayLinks() {
  return (
    <div className="mb-3 rounded-md border p-2.5">
      <p className="mb-2 text-[13px] font-semibold">Go looking in Foreplay</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {LINKS.map(([label, href, icon]) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {icon}
            {label}
            <ArrowUpRight className="h-3 w-3 opacity-60" />
          </a>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        Anything the team saves into the Foreplay drop box lands on this board
        by itself, wherever they save it from.
      </p>
    </div>
  );
}
