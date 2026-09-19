import { useAction } from "convex/react";
import { Clapperboard, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { shortDate } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip, type StatusTone } from "@/components/ceo/StatusChip";
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
  new: "queued",
  preparing: "preparing",
  ready: "ready to read",
  approved: "approved",
  publishing: "publishing",
  published: "published",
  failed: "failed",
  discarded: "discarded",
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
const label =
  "text-[11px] font-bold uppercase tracking-wide text-muted-foreground";

/** The thumbnail as the worker will draw it, near enough to decide on. */
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
        <div className="grid gap-2 rounded-md border p-3 text-sm">
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
              className="inline-flex w-fit items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Open Google's consent page{" "}
              <ExternalLink className="size-3.5" aria-hidden />
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
            <button
              type="button"
              disabled={busy || !/code=|^4\//.test(paste.trim())}
              onClick={() => {
                setBusy(true);
                void onConnect(paste.trim())
                  .then(() => setPaste(""))
                  .finally(() => setBusy(false));
              }}
              className="shrink-0 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
            >
              Connect
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NewPost({ onCreated }: { onCreated: (p: Post) => void }) {
  const uploadUrl = useAction(api.ceo.posting.uploadUrl);
  const create = useAction(api.ceo.posting.create);
  const [kind, setKind] = useState<"reel" | "video">("reel");
  const [source, setSource] = useState<"upload" | "drive" | "url">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [ref, setRef] = useState("");
  const [title, setTitle] = useState("");
  const [targets, setTargets] = useState<string[]>(["instagram", "youtube"]);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setTargets(kind === "video" ? ["youtube"] : ["instagram", "youtube"]);
  }, [kind]);

  const toggle = (t: string) =>
    setTargets(ts => (ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t]));

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
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
      const p = await create({
        kind,
        sourceKind,
        sourceRef,
        titleWorking: title.trim() || undefined,
        targets,
      });
      setFile(null);
      setRef("");
      setTitle("");
      setProgress(null);
      setMsg(
        "Queued. The desk fetches it, listens, writes and renders within a few minutes.",
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
    (source === "upload" ? Boolean(file) : ref.trim().length > 8);

  return (
    <div className="grid gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">New post</span>
        <div className="ml-auto flex gap-1">
          {(["reel", "video"] as const).map(k => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${kind === k ? "bg-foreground text-background" : "text-muted-foreground"}`}
            >
              {k === "reel" ? "Reel" : "Long video"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-1">
        {(
          [
            ["upload", "Upload a file"],
            ["drive", "Google Drive link"],
            ["url", "Link"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            aria-pressed={source === k}
            onClick={() => setSource(k)}
            className={`rounded-md border px-2.5 py-1 text-xs ${source === k ? "bg-muted font-medium" : "text-muted-foreground"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {source === "upload" ? (
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
              ? "https://drive.google.com/file/d/…"
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
        placeholder="Working title, what the video is about (optional but helps the copy)"
        dir="auto"
        aria-label="Working title"
        className={field}
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {["instagram", "youtube"].map(t => (
          <label
            key={t}
            htmlFor={`target-${t}`}
            className="flex items-center gap-1.5"
          >
            <input
              id={`target-${t}`}
              type="checkbox"
              checked={targets.includes(t)}
              onChange={() => toggle(t)}
            />
            {PLATFORM_LABEL[t]}
          </label>
        ))}
        <span className="text-xs text-muted-foreground">
          TikTok, LinkedIn and X come with the cross-post step.
        </span>
      </div>
      {progress !== null ? (
        <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
          <div
            className="h-full bg-foreground transition-[width]"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {busy
            ? progress !== null
              ? `Uploading ${Math.round(progress * 100)}%`
              : "Queuing…"
            : "Prepare it"}
        </button>
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
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip
          tone={STATUS_TONE[post.status] ?? "neutral"}
          label={STATUS_LABEL[post.status] ?? post.status}
        />
        <span className="text-xs text-muted-foreground">
          {[
            post.kind === "video" ? "long video" : "reel",
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
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => discard({ id: post.id }), "Discarded.")}
              className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              Discard
            </button>
          ) : null}
          {["failed", "ready"].includes(post.status) ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                act(() => reprepare({ id: post.id }), "Preparing again.")
              }
              className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              Prepare again
            </button>
          ) : null}
        </div>
      </div>
      {post.error ? (
        <p className="rounded-md border border-[var(--ceo-critical)]/40 p-2 text-sm">
          {post.error}
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
        <div className="grid gap-2 rounded-md border p-3 text-sm">
          <div className={label}>Where it went</div>
          {post.targets.map(t => {
            const p = pub[t];
            return (
              <div key={t} className="flex flex-wrap items-center gap-2">
                <span className="w-24 font-medium">
                  {PLATFORM_LABEL[t] ?? t}
                </span>
                {p?.id ? (
                  <>
                    <StatusChip
                      tone="good"
                      label={
                        t === "youtube"
                          ? `live · ${p.privacy ?? "public"}`
                          : "live"
                      }
                    />
                    {p.permalink || p.url ? (
                      <a
                        href={p.permalink ?? p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs hover:underline"
                      >
                        open <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {shortDate(p.at)}
                    </span>
                  </>
                ) : (
                  <>
                    <StatusChip
                      tone="warning"
                      label={
                        t === "instagram" && p?.container
                          ? "Meta is processing"
                          : "waiting for the worker"
                      }
                    />
                    {t === "instagram" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          act(() => checkInstagram({ id: post.id }))
                        }
                        className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
                      >
                        Check now
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {post.urls.video ? (
        <video
          src={post.urls.video}
          controls
          preload="metadata"
          className={`max-h-80 rounded-md bg-black ${post.kind === "reel" ? "aspect-[9/16] w-auto" : "w-full"}`}
        >
          <track kind="captions" />
        </video>
      ) : null}

      {post.frames.length ? (
        <div className="grid gap-3">
          <div className={label}>Thumbnail</div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <ThumbPreview frameUrl={frameUrl} text={thumbText} />
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {post.frames.map(f => (
                  <button
                    key={f.ms}
                    type="button"
                    onClick={() => setFrameMs(f.ms)}
                    aria-pressed={frameMs === f.ms}
                    title={`${mmss(f.ms / 1000)}`}
                    className={`shrink-0 overflow-hidden rounded border-2 ${frameMs === f.ms ? "border-foreground" : "border-transparent"}`}
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
                placeholder="The line on the thumbnail, two to five words"
                aria-label="Thumbnail line"
                disabled={!editable}
                className={field}
              />
              {post.thumbTextOptions.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {post.thumbTextOptions.map(o => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setThumbText(o)}
                      disabled={!editable}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${thumbText === o ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
                      dir="auto"
                    >
                      {o}
                    </button>
                  ))}
                </div>
              ) : null}
              {editable ? (
                <button
                  type="button"
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
                  className="w-fit rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                >
                  Render again
                </button>
              ) : null}
            </div>
            <div className="grid content-start gap-2">
              <span className="text-xs text-muted-foreground">Rendered</span>
              {post.urls.thumb ? (
                <img
                  src={post.urls.thumb}
                  alt=""
                  className="aspect-video w-full rounded-md object-cover"
                />
              ) : (
                <div className="aspect-video w-full rounded-md bg-muted" />
              )}
              {post.urls.cover ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <img
                    src={post.urls.cover}
                    alt=""
                    className="h-20 w-auto rounded"
                  />
                  reel cover
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {post.status !== "new" && post.status !== "preparing" ? (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="grid gap-2">
            <div className={label}>YouTube</div>
            {post.ytTitleOptions.length ? (
              <div className="flex flex-wrap gap-1.5">
                {post.ytTitleOptions.map(o => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setYtTitle(o)}
                    disabled={!editable}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${ytTitle === o ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
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
            <div
              className="text-[11px] text-muted-foreground"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >{`${ytTitle.length} characters`}</div>
            <textarea
              value={ytDescription}
              onChange={e => setYtDescription(e.target.value)}
              dir="auto"
              rows={10}
              placeholder="Description, with the chapters"
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
          <div className="grid gap-2">
            <div className={label}>Instagram</div>
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
            <div
              className="text-[11px] text-muted-foreground"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >{`${igCaption.length} of 2,200 characters`}</div>
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
        </div>
      ) : null}

      {segments.length ? (
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer text-sm font-medium">{`Transcript · ${segments.length} lines${post.transcript?.language ? ` · ${post.transcript.language}` : ""}`}</summary>
          <div className="mt-2 grid max-h-72 gap-1 overflow-y-auto" dir="auto">
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
            <span className={label}>Publish to</span>
            {["instagram", "youtube"].map(t => (
              <label
                key={t}
                htmlFor={`edit-target-${t}`}
                className="flex items-center gap-1.5"
              >
                <input
                  id={`edit-target-${t}`}
                  type="checkbox"
                  checked={targets.includes(t)}
                  onChange={() =>
                    setTargets(ts =>
                      ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t],
                    )
                  }
                />
                {PLATFORM_LABEL[t]}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={() => act(doSave, "Saved.")}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              Save edits
            </button>
            {confirming ? (
              <>
                <span className="text-sm">
                  {`This publishes ${targets.includes("instagram") ? "the reel on Instagram now" : ""}${targets.length === 2 ? " and " : ""}${targets.includes("youtube") ? "the video on YouTube as public" : ""}. Sure?`}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      if (dirty) await doSave();
                      await approve({ id: post.id });
                      setConfirming(false);
                    }, "Approved. Instagram publishes now; YouTube follows from the worker.")
                  }
                  className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "Publishing…" : "Yes, publish"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                >
                  Not yet
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={
                  busy || targets.length === 0 || post.status !== "ready"
                }
                onClick={() => setConfirming(true)}
                className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
              >
                Approve and publish
              </button>
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
        kicker="Mahara's own channels · nothing goes out before you approve it"
        title="Posting desk"
        order={0}
      >
        {() => (
          <div className="grid gap-5">
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

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-6">
        <SectionCard
          title="Posts"
          kicker={
            posts
              ? `${counts.ready ?? 0} to read · ${counts.published ?? 0} published`
              : undefined
          }
          order={1}
        >
          {() =>
            posts === null ? null : posts.length ? (
              <div className="grid gap-1.5">
                {posts.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    aria-pressed={selectedId === p.id}
                    className={`flex items-center gap-3 rounded-md border p-2 text-left hover:bg-muted/40 ${selectedId === p.id ? "ring-1 ring-foreground" : ""}`}
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
                        <span className="text-[11px] text-muted-foreground">{`${p.kind === "video" ? "video" : "reel"} · ${p.targets.map(t => PLATFORM_LABEL[t] ?? t).join(", ")}`}</span>
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
              <p className="text-sm text-muted-foreground">
                Pick a post on the left.
              </p>
            )
          }
        </SectionCard>
      </div>
    </div>
  );
}
