import { useAction } from "convex/react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";

/**
 * What a post is made of, and how files get onto it.
 *
 * Aziz, 2026-09-23: a post is not only pictures the AI drew. It can be our
 * own photos, our own video, or a carousel that mixes them, in the order
 * somebody arranged. One item is a single post, a lone video is a Reel,
 * two to ten is a carousel -- Instagram's own rule.
 */

export type MediaItem = {
  kind: "image" | "video";
  url: string;
  source: "upload" | "ai";
  cover?: string | null;
};

/** Work Salma has queued or is doing on the month. */
export type Job = {
  id: string;
  kind: string;
  post_id: string | null;
  params: { index?: number; add?: boolean } | null;
  status: string;
};

export type Platform = "instagram" | "facebook";

export const PLATFORMS: { key: Platform; label: string; limit: number }[] = [
  { key: "instagram", label: "Instagram", limit: 2200 },
  { key: "facebook", label: "Facebook", limit: 5000 },
];

/**
 * The shapes a post can take, as Instagram's composer offers them. Every
 * item of a carousel shares the post's shape; a lone video is a Reel and
 * is 9:16 whatever the post says.
 */
export type Aspect = "1:1" | "4:5" | "3:4" | "1.91:1";

export const ASPECTS: {
  key: Aspect;
  label: string;
  size: string;
  ratio: number;
  note?: string;
}[] = [
  { key: "1:1", label: "Square", size: "1080 × 1080", ratio: 1 },
  { key: "4:5", label: "Portrait", size: "1080 × 1350", ratio: 4 / 5 },
  {
    key: "3:4",
    label: "Tall",
    size: "1080 × 1440",
    ratio: 3 / 4,
    // Meta's media reference: images "must be within a 4:5 to 1.91:1 range".
    note: "Instagram's app takes 3:4, but its publishing API refuses it, so a 3:4 post has to go out by hand.",
  },
  { key: "1.91:1", label: "Landscape", size: "1080 × 566", ratio: 1.91 },
];

export const REEL = { label: "Reel", size: "1080 × 1920", ratio: 9 / 16 };

/** Width over height for what is on screen: the Reel, or the post's shape. */
export function ratioOf(aspect: string | null | undefined, items: MediaItem[]) {
  if (items.length === 1 && items[0].kind === "video") return REEL.ratio;
  return ASPECTS.find(a => a.key === aspect)?.ratio ?? 4 / 5;
}

/** Posts made before items existed carry only their pictures. */
export function itemsOf(p: {
  media?: MediaItem[] | null;
  images?: string[] | null;
}): MediaItem[] {
  if (p.media?.length) return p.media;
  return (p.images ?? []).map(url => ({ kind: "image", url, source: "ai" }));
}

/** What the post is, the way Instagram will treat it. */
export function formatOf(items: MediaItem[]): string | null {
  if (items.length > 1) return `Carousel of ${items.length}`;
  if (items[0]?.kind === "video") return "Reel";
  return null;
}

const TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
];
const MAX_BYTES = 1024 ** 3;
// Meta's media reference: Reels are "300MB maximum".
const MAX_VIDEO_BYTES = 300 * 1024 ** 2;

/** Why a file cannot go up, before anything is sent. */
export function refuse(file: File, only?: "image"): string | null {
  const type = file.type.toLowerCase();
  if (/heic|heif/.test(type) || /\.hei[cf]$/i.test(file.name))
    return `${file.name} is a HEIC photo, which Instagram does not take. Export it as a JPEG and upload that.`;
  if (only === "image" && !type.startsWith("image/"))
    return `${file.name} is not a picture.`;
  if (!TYPES.includes(type))
    return `${file.name} is not a JPEG, PNG, WebP, MP4, MOV or WebM file.`;
  if (type.startsWith("video/") && file.size > MAX_VIDEO_BYTES)
    return `${file.name} is over 300 MB, the most Instagram takes for a video. Export a smaller copy (1080p is plenty) and upload that.`;
  if (file.size > MAX_BYTES)
    return `${file.name} is over 1 GB. Export a smaller copy and upload that.`;
  return null;
}

type Signed = { uploadUrl: string; publicUrl: string; kind: "image" | "video" };

/**
 * Send one file straight to storage on a single-use link.
 *
 * XMLHttpRequest rather than fetch because fetch still cannot report
 * upload progress, and a reel with no progress looks like a frozen page.
 */
function putFile(
  signed: Signed,
  file: File,
  onProgress: (share: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signed.uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new Error(
              `${file.name} did not upload (storage said ${xhr.status}). Try it again.`,
            ),
          );
    xhr.onerror = () =>
      reject(new Error(`${file.name} lost its connection. Try it again.`));
    xhr.send(file);
  });
}

export type Pending = {
  id: string;
  name: string;
  kind: "image" | "video";
  share: number;
  preview: string;
};

function message(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const m = /Uncaught Error: ([^\n]+)/.exec(raw);
  return (
    (m ? m[1] : raw).replace(/\s+at .*$/s, "").trim() || "That did not work."
  );
}

/**
 * Upload files for one client, keeping a visible row per file while it
 * goes. Resolves with the items that made it, in the order they were
 * picked; a file that failed says why and is left out.
 */
export function useUploader(clientId: string) {
  const sign = useAction(api.social.uploadUrl);
  const [pending, setPending] = useState<Pending[]>([]);

  const upload = useCallback(
    async (files: File[], only?: "image"): Promise<MediaItem[]> => {
      const ok: File[] = [];
      for (const f of files) {
        const why = refuse(f, only);
        if (why) toast.error(why);
        else ok.push(f);
      }
      if (!ok.length) return [];
      const rows = ok.map(file => ({
        file,
        id: crypto.randomUUID(),
        preview: URL.createObjectURL(file),
      }));
      setPending(p => [
        ...p,
        ...rows.map(r => ({
          id: r.id,
          name: r.file.name,
          kind: r.file.type.startsWith("video/")
            ? ("video" as const)
            : ("image" as const),
          share: 0,
          preview: r.preview,
        })),
      ]);
      const settled = await Promise.allSettled(
        rows.map(async r => {
          const signed = (await sign({
            clientTaskId: clientId,
            filename: r.file.name,
            contentType: r.file.type,
          })) as Signed;
          await putFile(signed, r.file, share =>
            setPending(p => p.map(x => (x.id === r.id ? { ...x, share } : x))),
          );
          return {
            kind: signed.kind,
            url: signed.publicUrl,
            source: "upload",
            ...(signed.kind === "video" ? { cover: null } : {}),
          } as MediaItem;
        }),
      );
      setPending(p => p.filter(x => !rows.some(r => r.id === x.id)));
      for (const r of rows) URL.revokeObjectURL(r.preview);
      for (const s of settled)
        if (s.status === "rejected") toast.error(message(s.reason));
      return settled.flatMap(s => (s.status === "fulfilled" ? [s.value] : []));
    },
    [sign, clientId],
  );

  return { pending, upload };
}
