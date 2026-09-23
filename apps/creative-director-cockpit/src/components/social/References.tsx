import { useAction } from "convex/react";
import { Check, Library, LoaderCircle, Upload, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { useUploader } from "./media";

/**
 * Pictures the AI takes its look from when it draws for this post: the
 * client's own photos from their library, or any example somebody likes.
 * They steer the drawing; they never appear in the post themselves.
 */

const MAX = 6;

type Photo = { id: string; url: string; caption: string | null };

function message(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const m = /Uncaught Error: ([^\n]+)/.exec(raw);
  return (
    (m ? m[1] : raw).replace(/\s+at .*$/s, "").trim() || "That did not work."
  );
}

/** The client's photo library, loaded when first asked for. */
export function useLibrary(clientId: string) {
  const list = useAction(api.social.library);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const load = useCallback(async () => {
    try {
      setPhotos((await list({ clientTaskId: clientId })) as Photo[]);
    } catch (e) {
      setPhotos([]);
      toast.error(message(e));
    }
  }, [list, clientId]);
  return { photos, load };
}

export function References({
  clientId,
  refs,
  onChange,
}: {
  clientId: string;
  refs: string[];
  onChange: (next: string[]) => void | Promise<void>;
}) {
  const { pending, upload } = useUploader(clientId);
  const { photos, load } = useLibrary(clientId);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (picking && photos === null) void load();
  }, [picking, photos, load]);

  function toggle(url: string) {
    if (refs.includes(url)) return void onChange(refs.filter(r => r !== url));
    if (refs.length >= MAX)
      return void toast.error(
        "Six references is plenty. Take one off to add another.",
      );
    void onChange([...refs, url]);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[13px] font-medium">References</span>
        <span className="text-[12px] text-muted-foreground">
          What the AI's pictures take their look from
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {refs.map(u => (
          <span
            key={u}
            className="group relative h-[60px] w-12 overflow-hidden rounded-md border"
          >
            <img src={u} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              aria-label="Take this reference off"
              onClick={() => void onChange(refs.filter(r => r !== u))}
              className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {pending.map(p => (
          <span
            key={p.id}
            className="relative flex h-[60px] w-12 items-center justify-center overflow-hidden rounded-md border"
          >
            <img
              src={p.preview}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-50"
            />
            <LoaderCircle className="relative h-4 w-4 animate-spin" />
          </span>
        ))}
        {refs.length + pending.length < MAX ? (
          <>
            <label className="flex h-[60px] w-12 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border border-dashed text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground focus-within:ring-2 focus-within:ring-ring">
              <Upload className="h-3.5 w-3.5" />
              Upload
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={e => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (!files.length) return;
                  void (async () => {
                    const got = await upload(files, "image");
                    if (got.length)
                      await onChange(
                        [...refs, ...got.map(g => g.url)].slice(0, MAX),
                      );
                  })();
                }}
              />
            </label>
            <button
              type="button"
              aria-expanded={picking}
              onClick={() => setPicking(!picking)}
              className={`flex h-[60px] w-12 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed text-[10px] hover:bg-muted hover:text-foreground ${
                picking ? "bg-muted text-foreground" : "text-muted-foreground"
              }`}
            >
              <Library className="h-3.5 w-3.5" />
              Library
            </button>
          </>
        ) : null}
      </div>

      {picking ? (
        <div className="mt-2 rounded-lg border p-2">
          {photos === null ? (
            <p className="flex items-center gap-2 p-2 text-[12px] text-muted-foreground">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Opening the library
            </p>
          ) : photos.length === 0 ? (
            <p className="p-2 text-[12px] text-muted-foreground">
              This client has no photos in their library yet. Add their own
              photos in Settings, then pick them here.
            </p>
          ) : (
            <div className="grid max-h-56 grid-cols-5 gap-1.5 overflow-y-auto">
              {photos.map(ph => {
                const on = refs.includes(ph.url);
                return (
                  <button
                    key={ph.id}
                    type="button"
                    aria-pressed={on}
                    title={ph.caption ?? undefined}
                    onClick={() => toggle(ph.url)}
                    className={`relative aspect-[4/5] overflow-hidden rounded-md border ${
                      on ? "ring-2 ring-primary" : ""
                    }`}
                  >
                    <img
                      src={ph.url}
                      alt={ph.caption ?? ""}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    {on ? (
                      <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
