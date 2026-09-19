import { Play } from "lucide-react";
import { useState } from "react";
import { adPreview, type AdPreview as Preview } from "../lib/portal";
import Lightbox from "./Lightbox";

/**
 * A winning ad, watchable.
 *
 * Two routes, and the first is much better. `watchUrl` is Facebook's ordinary
 * video embed, resolved once from the ad's permalink and stored: it renders
 * for anybody, signed in or not, and does not expire. The fallback is Meta's
 * ads preview, whose token dies within hours and which only draws for a
 * browser already in the ad account.
 *
 * Either way it opens over the page rather than inside a card column. An ad
 * is a nine-by-sixteen video and a column is the wrong shape for it.
 */
export default function AdPreviewFrame({
  adId,
  title,
  thumbUrl,
  format,
  watchUrl,
  ourCopy,
}: {
  adId: string;
  title: string;
  thumbUrl?: string | null;
  format?: string | null;
  watchUrl?: string | null;
  /** A signed link to our own stored file. The best of the three. */
  ourCopy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [preview, setPreview] = useState<Preview | null>(null);

  async function openIt() {
    setOpen(true);
    if (ourCopy || watchUrl || state !== "idle") return;
    setState("loading");
    setPreview(await adPreview(adId, format ?? undefined));
    setState("done");
  }

  const still = preview?.stillUrl ?? preview?.thumbUrl ?? thumbUrl ?? null;

  return (
    <>
      <button
        type="button"
        onClick={openIt}
        className="raised group relative block aspect-[4/5] w-full overflow-hidden rounded-[var(--radius-md)]"
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
          />
        ) : null}
        <span className="absolute inset-0 grid place-items-center bg-black/10 transition-colors group-hover:bg-black/25">
          <span className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white">
            <Play className="size-3" strokeWidth={2.5} />
            Watch
          </span>
        </span>
      </button>

      {open ? (
        <Lightbox title={title} onClose={() => setOpen(false)}>
          {ourCopy ? (
            // Our own file. No Facebook, no Foreplay, no expiry.
            <div className="bg-black">
              {/* biome-ignore lint/a11y/useMediaCaption: an ad carries none */}
              <video
                src={ourCopy}
                poster={thumbUrl ?? undefined}
                controls
                autoPlay
                playsInline
                className="max-h-[75vh] w-full object-contain"
              />
            </div>
          ) : watchUrl ? (
            <div className="aspect-[9/16] w-full">
              <iframe
                src={watchUrl}
                title={title}
                allow="autoplay; encrypted-media; picture-in-picture; web-share"
                allowFullScreen
                className="size-full border-0"
              />
            </div>
          ) : state === "loading" ? (
            <p className="muted p-10 text-center text-sm">
              Asking Meta for a preview…
            </p>
          ) : preview?.ok && preview.src ? (
            <div className="space-y-2 p-3">
              <iframe
                src={preview.src}
                title={title}
                className="w-full border-0"
                style={{
                  height: Math.min(720, Math.max(420, preview.height ?? 560)),
                }}
              />
              <p className="muted text-[11px] leading-snug">
                Blank?{" "}
                <a
                  href={preview.src}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[color:var(--primary)] underline underline-offset-2"
                >
                  Open it in a tab
                </a>
                . Meta only draws this one for a browser signed in to the ad
                account.
              </p>
            </div>
          ) : (
            <div className="space-y-3 p-4 text-center">
              {still ? (
                <img
                  src={still}
                  alt=""
                  className="mx-auto max-h-96 rounded-[var(--radius-md)]"
                />
              ) : null}
              <p className="muted text-sm">
                {preview?.error ??
                  preview?.message ??
                  preview?.reason ??
                  "Meta would not render this one."}
              </p>
            </div>
          )}
        </Lightbox>
      ) : null}
    </>
  );
}
