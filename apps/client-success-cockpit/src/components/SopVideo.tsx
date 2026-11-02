import { ArrowUpRight, Play, X } from "lucide-react";
import { useState } from "react";
import { type SopVideoInfo, wistiaPlayer } from "../lib/cockpits";

/**
 * One SOP video, played where its work happens (SOP_VIDEOS in cockpits.ts).
 * Folded it is one line: play, the title with its length, and Open in Drive.
 * The player only loads once opened, so a page with a video costs nothing
 * until someone presses play. Wistia plays it with no sign-in; Open in Drive
 * is the source file, for a download or a comment.
 *
 * The same file sits in each of the five apps (scripts/check-shared.sh).
 */
export function SopVideo({
  video,
  startOpen = false,
  flat = false,
  className = "",
}: {
  video: SopVideoInfo;
  startOpen?: boolean;
  /** A row inside a card that already has its border (the Links pages). */
  flat?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(startOpen);
  const Icon = open ? X : Play;
  return (
    <section
      aria-label={`How-to video: ${video.title}`}
      data-sop-video={video.key}
      className={`${flat ? "" : "rounded-xl border bg-card p-3 sm:px-4"} ${className}`}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label={
            open
              ? `Close the video: ${video.title}`
              : `Play the video: ${video.title}`
          }
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Icon aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="min-w-0 flex-1 text-left"
          tabIndex={-1}
        >
          <span className="block text-sm font-medium">
            {video.title}
            <span className="ml-2 font-mono text-[11px] tabular-nums text-muted-foreground">
              {video.length}
            </span>
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {video.note}
          </span>
        </button>
        <a
          href={video.url}
          target="_blank"
          rel="noreferrer noopener"
          className="hidden shrink-0 items-center gap-0.5 text-xs font-medium text-primary underline-offset-4 hover:underline sm:inline-flex"
        >
          Open in Drive
          <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      </div>
      {open ? (
        <div className="mt-3 aspect-video w-full overflow-hidden rounded-lg border bg-black">
          <iframe
            src={wistiaPlayer(video.wistia)}
            title={video.title}
            allow="autoplay; fullscreen"
            allowFullScreen
            className="size-full border-0"
          />
        </div>
      ) : null}
    </section>
  );
}
