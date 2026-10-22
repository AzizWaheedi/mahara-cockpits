import { ImageOff, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { adPreview, type AdPreview as Preview } from "../lib/portal";
import { FRAME_AT, metaLinkExpired, pickPicture } from "../lib/thumbs";
import Lightbox from "./Lightbox";

/** True once the element comes near the screen, so a frame loads only then. */
function useNear<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) setNear(true);
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return [ref, near] as const;
}

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
 *
 * The picture on the card comes from `pickPicture` (lib/thumbs.ts): Meta's
 * stored picture links have all expired, so a link that fails to load falls
 * to the next source and, with none left, the card says no picture is saved.
 */
export default function AdPreviewFrame({
  adId,
  title,
  thumbUrl,
  stillUrl,
  format,
  watchUrl,
  ourCopy,
  copyPending,
}: {
  adId: string;
  title: string;
  thumbUrl?: string | null;
  /** A still in our own storage, from the native ad mirror. */
  stillUrl?: string | null;
  format?: string | null;
  watchUrl?: string | null;
  /** A signed link to our own stored file. The best of the three. */
  ourCopy?: string;
  /** We hold a copy and its signed link is still on its way. */
  copyPending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [boxRef, near] = useNear<HTMLButtonElement>();
  const fail = (src: string) => setFailed(f => new Set(f).add(src));

  const picture = pickPicture({
    still: stillUrl,
    thumbUrl,
    ourCopy,
    copyPending,
    failed,
  });
  const poster = picture.kind === "image" ? picture.src : undefined;

  async function openIt() {
    setOpen(true);
    if (ourCopy || watchUrl || state !== "idle") return;
    setState("loading");
    setPreview(await adPreview(adId, format ?? undefined));
    setState("done");
  }

  const still =
    [preview?.stillUrl, preview?.thumbUrl, poster].find(
      (u): u is string => !!u && !metaLinkExpired(u) && !failed.has(u),
    ) ?? null;

  return (
    <>
      <button
        ref={boxRef}
        type="button"
        onClick={openIt}
        className="group relative block aspect-[4/5] w-full overflow-hidden rounded-xl bg-muted"
      >
        {picture.kind === "image" ? (
          <img
            key={picture.src}
            src={picture.src}
            alt=""
            loading="lazy"
            onError={() => fail(picture.src)}
            className="absolute inset-0 size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
          />
        ) : picture.kind === "frame" && near ? (
          <video
            key={picture.src}
            src={`${picture.src}${FRAME_AT}`}
            preload="metadata"
            muted
            playsInline
            aria-hidden
            tabIndex={-1}
            onError={() => fail(picture.src)}
            className="pointer-events-none absolute inset-0 size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
          />
        ) : null}
        <span className="absolute inset-0 grid place-items-center bg-black/10 transition-colors group-hover:bg-black/25">
          <span className="flex flex-col items-center gap-3">
            {picture.kind === "none" ? (
              <span className="flex flex-col items-center gap-1.5 text-muted-foreground">
                <ImageOff className="size-5" strokeWidth={1.75} />
                <span className="text-xs">No picture saved</span>
              </span>
            ) : null}
            <span className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white">
              <Play className="size-3" strokeWidth={2.5} />
              Watch
            </span>
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
                poster={poster}
                controls
                autoPlay
                playsInline
                className="max-h-[75vh] w-full object-contain"
              />
            </div>
          ) : watchUrl ? (
            // Sized by height, so a 9:16 ad fits a laptop screen instead of
            // running to 900px and scrolling inside the panel.
            <div className="mx-auto aspect-[9/16] h-[min(80dvh,720px)] max-w-full">
              <iframe
                src={watchUrl}
                title={title}
                allow="autoplay; encrypted-media; picture-in-picture; web-share"
                allowFullScreen
                className="size-full border-0"
              />
            </div>
          ) : state === "loading" ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
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
              <p className="text-xs leading-snug text-muted-foreground">
                Blank?{" "}
                <a
                  href={preview.src}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary underline-offset-4 hover:underline"
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
                  onError={() => fail(still)}
                  className="mx-auto max-h-96 rounded-lg"
                />
              ) : null}
              <p className="text-sm text-muted-foreground">
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
