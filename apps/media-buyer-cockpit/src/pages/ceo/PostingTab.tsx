import { useAction } from "convex/react";
import { ArrowUpRight, Clapperboard, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { FilterChips } from "@/components/ceo/FilterChips";
import { shortDate } from "@/components/ceo/format";
import { Kicker } from "@/components/ceo/Kicker";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip, type StatusTone } from "@/components/ceo/StatusChip";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Post } from "../../../convex/ceo/posting";
import type { CeoTabProps } from "./types";

/**
 * The posting desk. A finished video goes in on the left; the worker
 * listens, writes and renders; the post comes back on the right for Aziz
 * to read, change and approve. Nothing reaches Instagram or YouTube before
 * "Approve and publish", and the button says exactly what it will do.
 *
 * The one place the screen spends its boldness is the thumbnail workbench:
 * the frame strip, the line, and the render side by side, so the thing
 * people see first on YouTube is decided here and not in Ads Manager.
 */

type Channel = {
  platform: string;
  handle: string | null;
  connected: boolean;
  authUrl: string | null;
  note: string | null;
  live: boolean;
};

const STATUS_TONE: Record<string, StatusTone> = {
  new: "neutral",
  preparing: "warning",
  ready: "good",
  approved: "warning",
  publishing: "warning",
  published: "good",
  failed: "critical",
  discarded: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  new: "Queued",
  preparing: "Preparing",
  ready: "Ready to read",
  approved: "Approved",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
  discarded: "Discarded",
};

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
};

const isArabic = (s: string) => /[؀-ۿ]/.test(s);

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function serverMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return (
    raw
      .split("\n")[0]
      .replace(/^\[.*?]\s*/, "")
      .trim() || "That did not go through."
  );
}

/** PUT with progress, which fetch cannot report. */
function putWithProgress(
  url: string,
  file: File,
  onProgress: (frac: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new Error(
              `Upload failed (${xhr.status}): ${xhr.responseText.slice(0, 160)}`,
            ),
          );
    xhr.onerror = () =>
      reject(new Error("Upload failed: the connection dropped."));
    xhr.send(file);
  });
}

const field = "w-full rounded-md border bg-background px-2 py-1.5 text-sm";
/** Groups inside the desk sit on a quiet panel, never a second border. */
const panel = "rounded-xl bg-muted/40 p-4";

/** A suggestion that fills a field: the cockpit's pill, teal when it is the one in use. */
function pill(active: boolean) {
  return cn(
    "inline-flex min-h-8 items-center rounded-full px-3 py-1 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
    active
      ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
      : "text-muted-foreground ring-1 ring-inset ring-border hover:bg-muted hover:text-foreground",
  );
}

/** The thumbnail as the worker will draw it, near enough to decide on. */
/**
 * A CSS sketch of the cover the worker renders: navy with a faint grid and a
 * teal glow, the frame fading in below, the two lines at the top, white then
 * teal. The rendered file beside it is the truth; this only shows the words
 * in place while they are being changed.
 */
function CoverPreview({
  frameUrl,
  text,
}: {
  frameUrl: string | null | undefined;
  text: string;
}) {
  const parts = text.includes("|")
    ? text
        .split("|")
        .map(t => t.trim())
        .filter(Boolean)
        .slice(0, 2)
    : (() => {
        const words = text.trim().split(/\s+/).filter(Boolean);
        if (words.length < 2) return words.length ? [words.join(" ")] : [];
        const k = Math.ceil(words.length / 2);
        return [words.slice(0, k).join(" "), words.slice(k).join(" ")];
      })();
  const size = text.length > 26 ? "text-[13px]" : "text-base";
  return (
    <div
      className="relative mx-auto aspect-[9/16] h-96 overflow-hidden rounded-md"
      style={{
        background:
          "radial-gradient(ellipse 60% 30% at 50% 62%, rgba(46,211,208,0.32), transparent 70%), linear-gradient(#0a1730, #10264a 60%)",
      }}
      dir={isArabic(text) ? "rtl" : "ltr"}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            "linear-gradient(rgba(42,79,130,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(42,79,130,0.9) 1px, transparent 1px)",
          backgroundSize: "10% 10%",
        }}
      />
      {frameUrl ? (
        <img
          src={frameUrl}
          alt=""
          className="absolute inset-x-0 bottom-0 h-[75%] w-full object-cover object-[50%_18%]"
          style={{
            maskImage:
              "linear-gradient(to bottom, transparent, black 22%), linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
            maskComposite: "intersect",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent, black 22%), linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
            WebkitMaskComposite: "source-in",
          }}
        />
      ) : null}
      <div
        className={`absolute inset-x-2 top-[6%] grid gap-0.5 text-center font-bold leading-tight ${size}`}
      >
        {parts.map((line, i) => (
          <span
            key={`${i}-${line}`}
            className={
              i === 0
                ? "text-white [text-shadow:0_2px_6px_rgba(0,0,0,0.6)]"
                : "text-[#2ED3D0] [text-shadow:0_0_14px_rgba(46,211,208,0.85)]"
            }
          >
            {line}
          </span>
        ))}
      </div>
    </div>
  );
}

function ThumbPreview({ frameUrl, text }: { frameUrl?: string; text: string }) {
  const rtl = isArabic(text);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-md bg-[#122C4F]">
      {frameUrl ? (
        <img
          src={frameUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      <div
        className={`absolute inset-y-0 w-[47%] bg-[#122C4F]/90 ${rtl ? "right-0" : "left-0"}`}
      />
      <div
        className={`absolute inset-y-0 flex w-[47%] items-center px-[3.7%] ${rtl ? "right-0" : "left-0"}`}
      >
        <div
          className={`w-full bg-[#FBF9E4] px-[6%] py-[5%] ${rtl ? "border-r-[5px] text-right" : "border-l-[5px] text-left"} border-[#5B88B2]`}
        >
          <div
            dir={rtl ? "rtl" : "ltr"}
            className="font-extrabold leading-[1.15] text-black"
            style={{
              fontSize:
                text.length > 40
                  ? "0.95rem"
                  : text.length > 22
                    ? "1.15rem"
                    : "1.5rem",
            }}
          >
            {text || "…"}
          </div>
        </div>
      </div>
    </div>
  );
}

function Doors({
  channels,
  onConnect,
}: {
  channels: Channel[];
  onConnect: (redirectUrl: string) => Promise<void>;
}) {
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const yt = channels.find(c => c.platform === "youtube");
  // Nothing read yet: no empty row above the form.
  if (!channels.length) return null;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {channels.map(c => (
          <StatusChip
            key={c.platform}
            tone={c.connected ? "good" : c.live ? "warning" : "neutral"}
            label={`${PLATFORM_LABEL[c.platform] ?? c.platform}${c.handle ? ` @${c.handle}` : ""}${c.connected ? "" : c.live ? " · not connected" : " · later"}`}
          />
        ))}
      </div>
      {yt && !yt.connected ? (
        <div className={cn("grid gap-3 text-sm", panel)}>
          <p>
            <span className="font-medium">YouTube needs one consent.</span>{" "}
            {yt.authUrl
              ? "Open the link, allow, and you land on a page that looks broken. Copy that page's address from the bar and paste it here."
              : (yt.note ??
                "The worker has not written the link yet; it does within two minutes.")}
          </p>
          {yt.authUrl ? (
            <a
              href={yt.authUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: "w-fit",
              })}
            >
              Open Google's consent page
              <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          ) : null}
          <div className="flex gap-2">
            <input
              value={paste}
              onChange={e => setPaste(e.target.value)}
              placeholder="http://localhost/?code=…"
              dir="ltr"
              aria-label="The address Google sent you to"
              className={field}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy || !/code=|^4\//.test(paste.trim())}
              onClick={() => {
                setBusy(true);
                void onConnect(paste.trim())
                  .then(() => setPaste(""))
                  .finally(() => setBusy(false));
              }}
              className="shrink-0"
            >
              Connect
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type Kind = Post["kind"];

/** Three jobs, three flows. The order is the order Aziz posts in. */
const KINDS: { key: Kind; label: string; what: string }[] = [
  {
    key: "reel",
    label: "Reel",
    what: "A vertical clip. Cover, caption, Instagram and YouTube Shorts.",
  },
  {
    key: "video",
    label: "Long video",
    what: "YouTube. Title, description with chapters, tags, thumbnail.",
  },
  {
    key: "post",
    label: "Post",
    what: "One to ten images with a caption, on Instagram.",
  },
];
const KIND_LABEL: Record<Kind, string> = {
  reel: "reel",
  video: "long video",
  post: "post",
};
const DEFAULT_TARGETS: Record<Kind, string[]> = {
  reel: ["instagram", "youtube"],
  video: ["youtube"],
  post: ["instagram"],
};
/** Where each kind can go from here. */
const TARGET_CHOICES: Record<Kind, string[]> = {
  reel: ["instagram", "youtube"],
  video: ["youtube", "instagram"],
  post: ["instagram"],
};
const targetLabel = (kind: Kind, t: string) =>
  kind === "reel" && t === "youtube"
    ? "YouTube Shorts"
    : (PLATFORM_LABEL[t] ?? t);

/** What "publish" means for this kind and these targets, as one sentence. */
function publishSentence(kind: Kind, targets: string[]): string {
  const parts: string[] = [];
  if (targets.includes("instagram"))
    parts.push(
      kind === "post"
        ? "the post on Instagram now"
        : "the reel on Instagram now",
    );
  if (targets.includes("youtube"))
    parts.push(
      kind === "reel"
        ? "the Short on YouTube as public"
        : "the video on YouTube as public",
    );
  return `This publishes ${parts.join(" and ")}. Sure?`;
}

function NewPost({ onCreated }: { onCreated: (p: Post) => void }) {
  const uploadUrl = useAction(api.ceo.posting.uploadUrl);
  const create = useAction(api.ceo.posting.create);
  const [kind, setKind] = useState<Kind>("reel");
  const [source, setSource] = useState<"upload" | "drive" | "url">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [brief, setBrief] = useState("");
  const [ref, setRef] = useState("");
  const [title, setTitle] = useState("");
  const [targets, setTargets] = useState<string[]>(DEFAULT_TARGETS.reel);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setTargets(DEFAULT_TARGETS[kind]);
  }, [kind]);

  const toggle = (t: string) =>
    setTargets(ts => (ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t]));

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      let p: Post;
      if (kind === "post") {
        if (!images.length) throw new Error("Choose one to ten images first.");
        if (images.length > 10) throw new Error("Ten images at most.");
        if (brief.trim().length < 4)
          throw new Error("Say what the post is about, in a line or two.");
        const paths: string[] = [];
        setProgress(0);
        for (const [i, img] of images.entries()) {
          const { path, url } = await uploadUrl({ filename: img.name });
          await putWithProgress(url, img, done =>
            setProgress((i + done) / images.length),
          );
          paths.push(path);
        }
        p = await create({
          kind,
          sourceKind: "image",
          sourceRef: paths[0],
          images: paths,
          brief: brief.trim(),
          titleWorking: title.trim() || undefined,
          targets: ["instagram"],
        });
      } else {
        let sourceKind = source;
        let sourceRef = ref.trim();
        if (source === "upload") {
          if (!file) throw new Error("Choose a video file first.");
          const { path, url } = await uploadUrl({ filename: file.name });
          setProgress(0);
          await putWithProgress(url, file, setProgress);
          sourceKind = "upload";
          sourceRef = path;
        }
        p = await create({
          kind,
          sourceKind,
          sourceRef,
          titleWorking: title.trim() || undefined,
          targets,
        });
      }
      setFile(null);
      setImages([]);
      setBrief("");
      setRef("");
      setTitle("");
      setProgress(null);
      setMsg(
        kind === "post"
          ? "Queued. The desk writes the caption within a minute or two."
          : "Queued. The desk fetches it, listens, writes and renders within a few minutes.",
      );
      onCreated(p);
    } catch (e) {
      setMsg(serverMessage(e));
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    !busy &&
    targets.length > 0 &&
    (kind === "post"
      ? images.length > 0 && images.length <= 10 && brief.trim().length >= 4
      : source === "upload"
        ? Boolean(file)
        : ref.trim().length > 8);
  const chosen = KINDS.find(k => k.key === kind) ?? KINDS[0];

  return (
    <div className={cn("grid gap-3", panel)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-medium">New</span>
        <FilterChips
          ariaLabel="What you are posting"
          value={kind}
          onChange={setKind}
          options={KINDS.map(k => ({ key: k.key, label: k.label }))}
        />
        <span className="basis-full text-xs text-muted-foreground sm:basis-auto">
          {chosen.what}
        </span>
      </div>
      {kind === "post" ? (
        <>
          <input
            type="file"
            accept="image/*"
            multiple
            aria-label="Images"
            onChange={e => setImages(Array.from(e.target.files ?? []))}
            className="text-sm"
          />
          {images.length ? (
            <span className="text-xs text-muted-foreground">
              {`${images.length} image${images.length === 1 ? "" : "s"}, in this order`}
            </span>
          ) : null}
          <textarea
            value={brief}
            onChange={e => setBrief(e.target.value)}
            rows={3}
            dir="auto"
            placeholder="What this post is about, in your words. The caption is written from this."
            aria-label="Brief"
            className={field}
          />
        </>
      ) : null}
      {kind === "post" ? null : (
        <FilterChips
          ariaLabel="Where the video comes from"
          value={source}
          onChange={setSource}
          options={[
            { key: "upload", label: "Upload a file" },
            { key: "drive", label: "Google Drive link" },
            { key: "url", label: "Link" },
          ]}
        />
      )}
      {kind === "post" ? null : source === "upload" ? (
        <input
          type="file"
          accept="video/*"
          aria-label="Video file"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
      ) : (
        <input
          value={ref}
          onChange={e => setRef(e.target.value)}
          placeholder={
            source === "drive"
              ? "https://drive.google.com/file/d/… or a folder link"
              : "https://…/video.mp4"
          }
          dir="ltr"
          aria-label="Link"
          className={field}
        />
      )}
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder={
          kind === "post"
            ? "Working title (optional)"
            : "Working title, what the video is about (optional but helps the copy)"
        }
        dir="auto"
        aria-label="Working title"
        className={field}
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {TARGET_CHOICES[kind].map(t => (
          <label
            key={t}
            htmlFor={`target-${t}`}
            className="flex items-center gap-1.5"
          >
            <input
              id={`target-${t}`}
              type="checkbox"
              checked={targets.includes(t)}
              disabled={kind === "post"}
              onChange={() => toggle(t)}
            />
            {targetLabel(kind, t)}
          </label>
        ))}
        <span className="text-xs text-muted-foreground">
          TikTok, LinkedIn and X come with the cross-post step.
        </span>
      </div>
      {progress !== null ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {busy
            ? progress !== null
              ? `Uploading ${Math.round(progress * 100)}%`
              : "Queuing…"
            : "Prepare it"}
        </Button>
        {msg ? (
          <span className="text-sm text-muted-foreground">{msg}</span>
        ) : null}
      </div>
    </div>
  );
}

function Editor({
  post,
  onChanged,
}: {
  post: Post;
  onChanged: (p?: Post) => Promise<void>;
}) {
  const save = useAction(api.ceo.posting.save);
  const rerender = useAction(api.ceo.posting.rerender);
  const reprepare = useAction(api.ceo.posting.reprepare);
  const approve = useAction(api.ceo.posting.approve);
  const checkInstagram = useAction(api.ceo.posting.checkInstagram);
  const discard = useAction(api.ceo.posting.discard);

  const [ytTitle, setYtTitle] = useState(post.ytTitle ?? "");
  const [ytDescription, setYtDescription] = useState(post.ytDescription ?? "");
  const [ytTags, setYtTags] = useState(post.ytTags.join(", "));
  const [igCaption, setIgCaption] = useState(post.igCaption ?? "");
  const [igHashtags, setIgHashtags] = useState(post.igHashtags.join(" "));
  const [thumbText, setThumbText] = useState(post.thumbText ?? "");
  const [frameMs, setFrameMs] = useState<number | null>(post.thumbFrameMs);
  const [targets, setTargets] = useState<string[]>(post.targets);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // A fresh row from the worker replaces the fields it owns, unless Aziz is mid-edit.
  const [seen, setSeen] = useState(post.updatedAt);
  useEffect(() => {
    if (post.updatedAt === seen) return;
    setSeen(post.updatedAt);
    setYtTitle(post.ytTitle ?? "");
    setYtDescription(post.ytDescription ?? "");
    setYtTags(post.ytTags.join(", "));
    setIgCaption(post.igCaption ?? "");
    setIgHashtags(post.igHashtags.join(" "));
    setThumbText(post.thumbText ?? "");
    setFrameMs(post.thumbFrameMs);
    setTargets(post.targets);
  }, [post, seen]);

  const editable = ["ready", "failed"].includes(post.status);
  const dirty =
    ytTitle !== (post.ytTitle ?? "") ||
    ytDescription !== (post.ytDescription ?? "") ||
    ytTags !== post.ytTags.join(", ") ||
    igCaption !== (post.igCaption ?? "") ||
    igHashtags !== post.igHashtags.join(" ") ||
    thumbText !== (post.thumbText ?? "") ||
    targets.join() !== post.targets.join();

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (done) setMsg(done);
      await onChanged();
    } catch (e) {
      setMsg(serverMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doSave = () =>
    save({
      id: post.id,
      ytTitle,
      ytDescription,
      ytTags: ytTags
        .split(/[,\n]/)
        .map(t => t.trim())
        .filter(Boolean),
      igCaption,
      igHashtags: igHashtags
        .split(/\s+/)
        .map(t => t.trim())
        .filter(Boolean),
      thumbText,
      targets,
    });

  const frameUrl =
    frameMs !== null ? post.urls.frames?.[String(frameMs)] : undefined;
  const segments: { start?: number; text: string }[] = Array.isArray(
    post.transcript?.segments,
  )
    ? post.transcript.segments
    : [];
  const method = post.method ?? {};
  const pub = post.published ?? {};

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusChip
          tone={STATUS_TONE[post.status] ?? "neutral"}
          label={STATUS_LABEL[post.status] ?? post.status}
        />
        <span className="text-xs text-muted-foreground">
          {[
            KIND_LABEL[post.kind],
            post.kind === "post"
              ? `${post.images.length} image${post.images.length === 1 ? "" : "s"}`
              : null,
            post.durationSec ? mmss(post.durationSec) : null,
            post.width && post.height ? `${post.width}×${post.height}` : null,
            `added ${shortDate(post.createdAt)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {method.speech || method.copy ? (
          <span className="text-xs text-muted-foreground">
            {[
              method.speech
                ? `${String(method.speech).split(":")[0]} listened`
                : null,
              method.copy ? `${String(method.copy).split(":")[0]} wrote` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : null}
        <div className="ml-auto flex gap-2">
          {post.status !== "published" && post.status !== "publishing" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => act(() => discard({ id: post.id }), "Discarded.")}
            >
              Discard
            </Button>
          ) : null}
          {["failed", "ready"].includes(post.status) ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                act(() => reprepare({ id: post.id }), "Preparing again.")
              }
            >
              Prepare again
            </Button>
          ) : null}
        </div>
      </div>
      {post.error ? (
        <p className="flex items-start gap-2 rounded-xl bg-muted/40 px-4 py-3 text-sm">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0"
            style={{ color: "var(--ceo-critical)" }}
            aria-label="Error"
          />
          <span className="min-w-0 break-words">{post.error}</span>
        </p>
      ) : null}
      {method.notes ? (
        <p className="text-sm text-muted-foreground">{String(method.notes)}</p>
      ) : null}

      {post.status === "new" || post.status === "preparing" ? (
        <EmptyState
          title={
            post.status === "new" ? "Waiting for the desk" : "The desk is on it"
          }
          text="Fetching, listening, writing and rendering take a few minutes. This screen refreshes on its own."
          icon={Clapperboard}
          compact
        />
      ) : null}

      {(pub.instagram?.id ||
        pub.youtube?.id ||
        post.status === "publishing" ||
        post.status === "approved") && (
        <div className={cn("grid gap-3 text-sm", panel)}>
          <Kicker as="div">Where it went</Kicker>
          {post.targets.map(t => {
            const p = pub[t];
            return (
              <div
                key={t}
                className="flex flex-wrap items-center gap-x-3 gap-y-1"
              >
                <span className="w-24 font-medium">
                  {PLATFORM_LABEL[t] ?? t}
                </span>
                {p?.id ? (
                  <>
                    <StatusChip
                      tone="good"
                      label={
                        t === "youtube"
                          ? `Live, ${p.privacy ?? "public"}`
                          : "Live"
                      }
                    />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {shortDate(p.at)}
                    </span>
                    {p.permalink || p.url ? (
                      <a
                        href={p.permalink ?? p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        Open
                        <ArrowUpRight className="size-3.5" aria-hidden />
                      </a>
                    ) : null}
                  </>
                ) : (
                  <>
                    <StatusChip
                      tone="warning"
                      label={
                        t === "instagram" && p?.container
                          ? "Meta is processing"
                          : "Waiting for the worker"
                      }
                    />
                    {t === "instagram" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          act(() => checkInstagram({ id: post.id }))
                        }
                      >
                        Check now
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {post.kind === "post" && post.urls.images?.length ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {post.urls.images.map((u, i) => (
            <img
              key={u}
              src={u}
              alt={`${i + 1} of ${post.urls.images?.length ?? 0}`}
              className="h-40 w-auto shrink-0 rounded-md object-cover"
            />
          ))}
        </div>
      ) : null}

      {post.kind !== "post" && post.urls.video ? (
        <video
          src={post.urls.video}
          controls
          preload="metadata"
          className={`max-h-80 rounded-md bg-black ${post.kind === "reel" ? "aspect-[9/16] w-auto" : "w-full"}`}
        >
          <track kind="captions" />
        </video>
      ) : null}

      {post.kind !== "post" && post.frames.length ? (
        <div className="grid gap-3">
          <Kicker as="div">
            {post.kind === "reel" ? "Cover" : "Thumbnail"}
          </Kicker>
          <div className="grid gap-4 @2xl:grid-cols-2">
            <div className="grid gap-2">
              {post.kind === "reel" ? (
                <CoverPreview frameUrl={frameUrl} text={thumbText} />
              ) : (
                <ThumbPreview frameUrl={frameUrl} text={thumbText} />
              )}
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {post.frames.map(f => (
                  <button
                    key={f.ms}
                    type="button"
                    onClick={() => setFrameMs(f.ms)}
                    aria-pressed={frameMs === f.ms}
                    title={`${mmss(f.ms / 1000)}`}
                    className={`shrink-0 overflow-hidden rounded-md border-2 ${frameMs === f.ms ? "border-primary" : "border-transparent"}`}
                  >
                    {post.urls.frames?.[String(f.ms)] ? (
                      <img
                        src={post.urls.frames[String(f.ms)]}
                        alt=""
                        className="h-14 w-24 object-cover"
                      />
                    ) : (
                      <div className="h-14 w-24 bg-muted" />
                    )}
                  </button>
                ))}
              </div>
              <input
                value={thumbText}
                onChange={e => setThumbText(e.target.value)}
                dir="auto"
                placeholder={
                  post.kind === "reel"
                    ? "The two lines of the cover: setup | punch"
                    : "The line on the thumbnail, two to five words"
                }
                aria-label={
                  post.kind === "reel" ? "Cover lines" : "Thumbnail line"
                }
                disabled={!editable}
                className={field}
              />
              {post.thumbTextOptions.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {post.thumbTextOptions.map(o => (
                    <button
                      key={o}
                      type="button"
                      aria-pressed={thumbText === o}
                      onClick={() => setThumbText(o)}
                      disabled={!editable}
                      className={pill(thumbText === o)}
                      dir="auto"
                    >
                      {o}
                    </button>
                  ))}
                </div>
              ) : null}
              {editable ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || !thumbText.trim()}
                  onClick={() =>
                    act(
                      () =>
                        rerender({
                          id: post.id,
                          thumbText,
                          frameMs: frameMs ?? undefined,
                        }),
                      "Rendering; the picture updates within two minutes.",
                    )
                  }
                  className="w-fit"
                >
                  Render again
                </Button>
              ) : null}
            </div>
            <div className="grid content-start gap-2">
              <span className="text-xs text-muted-foreground">Rendered</span>
              {post.kind === "reel" ? (
                post.urls.cover ? (
                  <img
                    src={post.urls.cover}
                    alt=""
                    className="mx-auto aspect-[9/16] max-h-96 w-auto rounded-md object-cover"
                  />
                ) : (
                  <div className="mx-auto aspect-[9/16] h-96 rounded-md bg-muted" />
                )
              ) : post.urls.thumb ? (
                <img
                  src={post.urls.thumb}
                  alt=""
                  className="aspect-video w-full rounded-md object-cover"
                />
              ) : (
                <div className="aspect-video w-full rounded-md bg-muted" />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {post.status !== "new" && post.status !== "preparing" ? (
        <div
          className={`grid gap-6 ${targets.includes("youtube") && targets.includes("instagram") ? "@2xl:grid-cols-2" : ""}`}
        >
          {targets.includes("youtube") ? (
            <div className="grid content-start gap-2">
              <Kicker as="div">
                {post.kind === "reel" ? "YouTube Shorts" : "YouTube"}
              </Kicker>
              {post.ytTitleOptions.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {post.ytTitleOptions.map(o => (
                    <button
                      key={o}
                      type="button"
                      aria-pressed={ytTitle === o}
                      onClick={() => setYtTitle(o)}
                      disabled={!editable}
                      className={pill(ytTitle === o)}
                      dir="auto"
                    >
                      {o}
                    </button>
                  ))}
                </div>
              ) : null}
              <input
                value={ytTitle}
                onChange={e => setYtTitle(e.target.value)}
                dir="auto"
                placeholder="Title"
                aria-label="YouTube title"
                disabled={!editable}
                className={`${field} font-medium`}
              />
              <div className="text-xs text-muted-foreground tabular-nums">{`${ytTitle.length} characters`}</div>
              <textarea
                value={ytDescription}
                onChange={e => setYtDescription(e.target.value)}
                dir="auto"
                rows={post.kind === "reel" ? 5 : 10}
                placeholder={
                  post.kind === "reel"
                    ? "A few lines and #Shorts"
                    : "Description, with the chapters"
                }
                aria-label="YouTube description"
                disabled={!editable}
                className={field}
              />
              <input
                value={ytTags}
                onChange={e => setYtTags(e.target.value)}
                dir="auto"
                placeholder="Tags, separated by commas"
                aria-label="YouTube tags"
                disabled={!editable}
                className={field}
              />
            </div>
          ) : null}
          {targets.includes("instagram") ? (
            <div className="grid content-start gap-2">
              <Kicker as="div">Instagram</Kicker>
              <textarea
                value={igCaption}
                onChange={e => setIgCaption(e.target.value)}
                dir="auto"
                rows={10}
                placeholder="Caption"
                aria-label="Instagram caption"
                disabled={!editable}
                className={field}
              />
              <div className="text-xs text-muted-foreground tabular-nums">{`${igCaption.length} of 2,200 characters`}</div>
              <input
                value={igHashtags}
                onChange={e => setIgHashtags(e.target.value)}
                dir="auto"
                placeholder="#hashtags separated by spaces"
                aria-label="Instagram hashtags"
                disabled={!editable}
                className={field}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {segments.length ? (
        <details className={cn("text-sm", panel)}>
          <summary className="cursor-pointer text-sm font-medium">{`Transcript · ${segments.length} lines${post.transcript?.language ? ` · ${post.transcript.language}` : ""}`}</summary>
          <div className="mt-3 grid max-h-72 gap-1 overflow-y-auto" dir="auto">
            {segments.map((s, i) => (
              <div key={`${i}-${s.start ?? 0}`} className="flex gap-2">
                <span
                  className="shrink-0 text-xs text-muted-foreground"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {typeof s.start === "number" ? mmss(s.start) : "--:--"}
                </span>
                <span>{s.text}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {editable ? (
        <div className="grid gap-3 border-t pt-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Kicker as="span">Publish to</Kicker>
            {TARGET_CHOICES[post.kind].map(t => (
              <label
                key={t}
                htmlFor={`edit-target-${t}`}
                className="flex items-center gap-1.5"
              >
                <input
                  id={`edit-target-${t}`}
                  type="checkbox"
                  checked={targets.includes(t)}
                  disabled={post.kind === "post"}
                  onChange={() =>
                    setTargets(ts =>
                      ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t],
                    )
                  }
                />
                {targetLabel(post.kind, t)}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || !dirty}
              onClick={() => act(doSave, "Saved.")}
            >
              Save edits
            </Button>
            {confirming ? (
              <>
                <span className="basis-full text-sm sm:basis-auto">
                  {publishSentence(post.kind, targets)}
                </span>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      if (dirty) await doSave();
                      await approve({ id: post.id });
                      setConfirming(false);
                    }, "Approved. Instagram publishes now; YouTube follows from the worker.")
                  }
                >
                  {busy ? "Publishing…" : "Yes, publish"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirming(false)}
                >
                  Not yet
                </Button>
              </>
            ) : (
              <Button
                type="button"
                disabled={
                  busy || targets.length === 0 || post.status !== "ready"
                }
                onClick={() => setConfirming(true)}
              >
                Approve and publish
              </Button>
            )}
          </div>
        </div>
      ) : null}
      {msg ? <p className="text-sm">{msg}</p> : null}
    </div>
  );
}

export function PostingTab(_props: CeoTabProps) {
  const listPosts = useAction(api.ceo.posting.list);
  const getPost = useAction(api.ceo.posting.get);
  const listChannels = useAction(api.ceo.posting.channels);
  const youtubeConnect = useAction(api.ceo.posting.youtubeConnect);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([
        listChannels({}),
        listPosts({ limit: 40 }),
      ]);
      setChannels(c as Channel[]);
      setPosts(p as Post[]);
      setError(null);
    } catch (e) {
      setError(serverMessage(e));
    }
  }, [listChannels, listPosts]);

  const loadSelected = useCallback(async () => {
    if (selectedId === null) return;
    try {
      setPost((await getPost({ id: selectedId })) as Post);
    } catch (e) {
      setError(serverMessage(e));
    }
  }, [getPost, selectedId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    void loadSelected();
  }, [loadSelected]);

  // While the worker or Meta is busy with the selected post, look again often.
  const live = post
    ? ["new", "preparing", "approved", "publishing"].includes(post.status)
    : false;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void loadSelected();
    }, 12_000);
    return () => clearInterval(t);
  }, [live, loadSelected]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of posts ?? []) m[p.status] = (m[p.status] ?? 0) + 1;
    return m;
  }, [posts]);

  return (
    <div className="grid gap-4 lg:gap-6">
      <SectionCard
        kicker="Own channels"
        title="Posting desk"
        description="Nothing goes out before you approve it."
        order={0}
      >
        {() => (
          <div className="grid gap-6">
            <Doors
              channels={channels}
              onConnect={async url => {
                try {
                  await youtubeConnect({ redirectUrl: url });
                  setNotice(
                    "Connecting. The worker exchanges the code within two minutes; the YouTube chip turns green on its own.",
                  );
                } catch (e) {
                  setNotice(serverMessage(e));
                }
              }}
            />
            <NewPost
              onCreated={p => {
                setSelectedId(p.id);
                void load();
              }}
            />
            {notice ? <p className="text-sm">{notice}</p> : null}
            {error ? (
              <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
            ) : null}
          </div>
        )}
      </SectionCard>

      <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-6">
        <SectionCard
          title="Posts"
          description={
            posts
              ? `${counts.ready ?? 0} to read · ${counts.published ?? 0} published`
              : undefined
          }
          order={1}
        >
          {() =>
            posts === null ? null : posts.length ? (
              <div className="grid gap-1">
                {posts.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    aria-pressed={selectedId === p.id}
                    className={cn(
                      "flex items-center gap-3 rounded-lg p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selectedId === p.id
                        ? "bg-primary/10 ring-1 ring-inset ring-primary/40"
                        : "hover:bg-muted/60",
                    )}
                  >
                    {p.urls.thumb ? (
                      <img
                        src={p.urls.thumb}
                        alt=""
                        className="h-12 w-20 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <div className="h-12 w-20 shrink-0 rounded bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium" dir="auto">
                        {p.ytTitle ||
                          p.titleWorking ||
                          p.sourceRef.split("/").pop()}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <StatusChip
                          tone={STATUS_TONE[p.status] ?? "neutral"}
                          label={STATUS_LABEL[p.status] ?? p.status}
                        />
                        <span className="text-xs text-muted-foreground">{`${KIND_LABEL[p.kind]} · ${p.targets.map(t => PLATFORM_LABEL[t] ?? t).join(", ")}`}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Nothing on the desk"
                text="Add a finished reel or video above; it comes back here ready to read."
                icon={Clapperboard}
                compact
              />
            )
          }
        </SectionCard>

        <SectionCard
          title={
            post
              ? post.ytTitle || post.titleWorking || `Post ${post.id}`
              : "The post"
          }
          order={2}
        >
          {() =>
            post ? (
              <Editor
                key={`${post.id}-${post.updatedAt}`}
                post={post}
                onChanged={async () => {
                  await Promise.all([loadSelected(), load()]);
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Pick a post.</p>
            )
          }
        </SectionCard>
      </div>
    </div>
  );
}
