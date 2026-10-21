import { useState } from "react";
import { cn } from "@/lib/utils";
import type { VideoRow } from "./sources";
import { clock } from "./videos";

/**
 * A video slot as a poster card (DESIGN 22.5.3), in prep's Videos section
 * (352 x 198) and the notes window's Video block (240 x 135). Cockpit UI,
 * never the canvas. Not recorded: one quiet line, "Not recorded yet", no
 * card and no play glyph, so it never reads as a video that is there.
 * Recorded: the provider's own picture (the worker keeps it on the row as
 * `posterUrl`), else one built from the link (YouTube, Drive, Wistia's
 * swatch), else one 64 px row until a picture exists (score round 2: an
 * empty 16:9 box with a small play glyph read as a broken image): the
 * provider and the length over the title, and a 32 px play button. An image
 * that fails falls back to that row. Every picture sits under a 35% veil of
 * the panel's ground, so a near-white browser capture never reads as an
 * empty white card. In the notes window the picture carries no words: the
 * title is over it and the length on the line under it.
 */

const PROVIDER: Record<VideoRow["provider"], string> = {
  loom: "Loom",
  youtube: "YouTube",
  wistia: "Wistia",
  vimeo: "Vimeo",
  drive: "Google Drive",
};

/** The picture a recorded row can show without the worker's poster. */
export function posterFor(row: VideoRow): {
  src: string;
  swatch: boolean;
} | null {
  if (row.posterUrl) return { src: row.posterUrl, swatch: false };
  const yt = /youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{6,20})/.exec(
    row.embedUrl,
  );
  if (row.provider === "youtube" && yt)
    return {
      src: `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg`,
      swatch: false,
    };
  const drive = /\/file\/d\/([A-Za-z0-9_-]{10,200})/.exec(row.url);
  if (row.provider === "drive" && drive)
    return {
      src: `https://drive.google.com/thumbnail?id=${drive[1]}&sz=w640`,
      swatch: false,
    };
  const wistia = /\/(?:embed\/iframe|medias)\/([A-Za-z0-9]{6,20})/.exec(
    row.embedUrl,
  );
  if (row.provider === "wistia" && wistia)
    return {
      src: `https://fast.wistia.com/embed/medias/${wistia[1]}/swatch`,
      swatch: true,
    };
  return null;
}

function Triangle({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden
      className="drop-shadow"
    >
      <path d="M3 1.5v13l11-6.5z" fill="currentColor" />
    </svg>
  );
}

export function VideoPoster({
  title,
  row,
  size,
}: {
  title: string;
  row: VideoRow | null;
  size: "prep" | "notes";
}) {
  const [broken, setBroken] = useState(false);
  const box = size === "prep" ? "w-[352px] h-[198px]" : "w-[240px] h-[135px]";
  const base = cn(
    "relative max-w-full shrink-0 overflow-hidden rounded-lg border",
    box,
  );
  // Not recorded: one quiet line under the slot's title (the fixer's round).
  // A 16:9 blank card per empty slot made prep read as a column of empty
  // boxes; only a recorded video gets a card. The title is said once, by
  // the row above, so this line carries it only for a screen reader.
  if (!row)
    return (
      <div className="text-xs text-muted-foreground" data-video-empty="">
        <span className="sr-only">{title}: </span>Not recorded yet
      </div>
    );
  const pic = broken ? null : posterFor(row);
  const length = row.durationSeconds ? clock(row.durationSeconds) : null;
  if (!pic)
    // No picture yet: one row with the weight of the "Not recorded yet"
    // line, the provider and the length over the title, then the play.
    return (
      <div
        className={cn(
          "flex h-16 max-w-full items-center gap-3 rounded-lg border bg-muted px-3 text-foreground",
          size === "prep" ? "w-[352px]" : "w-[240px]",
        )}
        data-video-row=""
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] text-muted-foreground">
            {PROVIDER[row.provider]}
            {length ? ` · ${length}` : ""}
          </span>
          <span className="block truncate text-[13px] font-semibold leading-snug">
            {title}
          </span>
        </span>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-background">
          <Triangle size={14} />
        </span>
      </div>
    );
  return (
    <div className={cn(base, "bg-muted text-white")}>
      <img
        src={pic.src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={cn(
          "absolute inset-0 size-full object-cover",
          pic.swatch && "scale-110 blur-md",
        )}
      />
      {pic.swatch ? (
        <i className="absolute inset-0 bg-black/55" />
      ) : (
        <i className="absolute inset-0 bg-background/35" />
      )}
      <span className="absolute inset-0 grid place-items-center">
        <Triangle size={size === "prep" ? 24 : 18} />
      </span>
      {size === "prep" ? (
        <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/75 to-transparent px-3 pt-8 pb-2">
          <span className="line-clamp-2 text-[13px] font-semibold leading-snug">
            {title}
          </span>
          {length ? (
            <span className="shrink-0 text-xs tabular-nums opacity-90">
              {length}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
