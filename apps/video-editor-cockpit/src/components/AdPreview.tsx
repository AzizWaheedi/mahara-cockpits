import { Play } from "lucide-react";
import { useState } from "react";
import { adPreview, type AdPreview as Preview } from "../lib/portal";

/**
 * The Facebook preview of a winning ad.
 *
 * Meta's preview links expire within hours, which is why none is stored with
 * the row; the media buyer deployment fetches a fresh one when somebody asks
 * for it. So this loads on a click rather than on sight: thirty of these
 * mounting at once would be thirty Graph calls and thirty frames for a page
 * nobody has scrolled yet.
 */
export default function AdPreviewFrame({
  adId,
  thumbUrl,
  format,
  watchUrl,
}: {
  adId: string;
  thumbUrl?: string | null;
  format?: string | null;
  /** Facebook's public video embed, stored once and good forever. */
  watchUrl?: string | null;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [watching, setWatching] = useState(false);

  // The good path. Checked on 2026-09-19: this renders for anybody, signed
  // in to Facebook or not, where the ads preview frame renders only for
  // someone in the ad account and expires within hours.
  if (watchUrl) {
    if (watching) {
      return (
        <div className="raised aspect-[4/5] overflow-hidden rounded-[var(--radius-md)]">
          <iframe
            src={watchUrl}
            title="The ad"
            allow="autoplay; encrypted-media; picture-in-picture; web-share"
            allowFullScreen
            className="size-full border-0"
          />
        </div>
      );
    }
    return (
      <div className="raised relative aspect-[4/5] overflow-hidden rounded-[var(--radius-md)]">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}
        <button
          type="button"
          onClick={() => setWatching(true)}
          className="absolute inset-0 grid place-items-center"
        >
          <span className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white">
            <Play className="size-3" strokeWidth={2.5} />
            Watch the ad
          </span>
        </button>
      </div>
    );
  }

  async function load() {
    setState("loading");
    const out = await adPreview(adId, format ?? undefined);
    setPreview(out);
    setState("done");
  }

  if (state === "done" && preview?.ok && preview.src) {
    return (
      <div className="space-y-1.5">
        <div className="raised overflow-hidden rounded-[var(--radius-md)]">
          <iframe
            src={preview.src}
            title="The ad on Facebook"
            className="w-full border-0"
            style={{ height: Math.min(760, Math.max(420, preview.height ?? 560)) }}
          />
        </div>
        {/* Meta only draws this frame for a browser signed in to the ad
            account. Anyone else sees an empty box, so there is always a way
            through to the same preview in a tab. */}
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
          . Meta only draws it for a browser signed in to the ad account.
        </p>
      </div>
    );
  }

  const failed = state === "done" && !preview?.ok;
  const noRender = state === "done" && preview?.ok && !preview.src;
  const still = (state === "done" && (preview?.stillUrl ?? preview?.thumbUrl)) || thumbUrl;

  return (
    <div className="raised relative aspect-[4/5] overflow-hidden rounded-[var(--radius-md)]">
      {still ? (
        <img
          src={still}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      <button
        type="button"
        onClick={load}
        disabled={state === "loading"}
        className="absolute inset-0 grid place-items-center"
      >
        <span className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white">
          {state === "loading" ? (
            "Loading"
          ) : failed || noRender ? (
            "Try again"
          ) : (
            <>
              <Play className="size-3" strokeWidth={2.5} />
              See it on Facebook
            </>
          )}
        </span>
      </button>
      {failed || noRender ? (
        <p className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1 text-center text-[11px] text-white">
          {preview?.error ??
            preview?.message ??
            preview?.reason ??
            "Meta would not render this one."}
        </p>
      ) : null}
    </div>
  );
}
