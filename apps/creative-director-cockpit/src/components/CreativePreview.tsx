import { Play } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The actual ad, watchable in place.
 *
 * Two different things arrive from Meta and only one of them is reliable:
 * `previewSrc` is Meta's own rendered preview iframe (the real ad, video and
 * all), while `thumbUrl` is a still. We show the still as the trigger because
 * it loads instantly in a dense table, and open the iframe on click.
 *
 * When there is no preview we render a dimmed placeholder rather than nothing,
 * so a missing creative reads as "Meta gave us nothing here" instead of
 * looking like a layout bug.
 */
export function CreativePreview({
  name,
  thumbUrl,
  previewSrc,
  metaAdId,
  size = "sm",
}: {
  name: string;
  thumbUrl?: string;
  previewSrc?: string;
  metaAdId?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const box = size === "md" ? "h-14 w-14" : "h-10 w-10";

  if (!thumbUrl && !previewSrc) {
    return (
      <div
        className={`${box} shrink-0 rounded bg-muted ring-1 ring-border`}
        title="No creative preview available from Meta for this ad"
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={previewSrc ? "Watch this ad" : "View this creative"}
        className={`${box} group relative shrink-0 overflow-hidden rounded ring-1 ring-border transition hover:ring-2 hover:ring-primary`}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted" />
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition group-hover:opacity-100">
          <Play className="h-4 w-4 fill-white text-white" />
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">{name}</DialogTitle>
            <DialogDescription className="text-xs">
              {previewSrc
                ? "Meta's live preview of this ad."
                : "Still image only, Meta did not return a playable preview."}
            </DialogDescription>
          </DialogHeader>
          {previewSrc ? (
            <iframe
              src={previewSrc}
              title={name}
              className="h-[560px] w-full rounded border"
            />
          ) : (
            thumbUrl && (
              <img
                src={thumbUrl}
                alt={name}
                className="max-h-[560px] w-full rounded border object-contain"
              />
            )
          )}
          {metaAdId && (
            <a
              href={`https://adsmanager.facebook.com/adsmanager/manage/ads?selected_ad_ids=${metaAdId}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
            >
              Open in Ads Manager
            </a>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
