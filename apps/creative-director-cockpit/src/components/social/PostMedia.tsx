import { useAction } from "convex/react";
import {
  ArrowLeft,
  ArrowRight,
  Clapperboard,
  ImageUp,
  LoaderCircle,
  Play,
  Sparkles,
  Trash2,
  TriangleAlert,
  Type,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import {
  itemsOf,
  type Job,
  type Look,
  type MediaItem,
  type Pending,
  ratioOf,
  useUploader,
  type Words,
} from "./media";

/**
 * A post's items: the one on show, and the strip of all of them in order.
 *
 * The strip is the carousel itself, laid out the way it will swipe. Drag a
 * tile to reorder it; the arrows under the stage do the same from the
 * keyboard. Each tile says where it came from -- a small spark for a
 * picture the AI drew, nothing for our own -- because "draw again" only
 * ever applies to the first kind.
 */

const ACCEPT =
  "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm";

function message(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const m = /Uncaught Error: ([^\n]+)/.exec(raw);
  return (
    (m ? m[1] : raw).replace(/\s+at .*$/s, "").trim() || "That did not work."
  );
}

export function Stage({
  item,
  ratio,
  reel = false,
  onZoom,
  empty,
}: {
  item: MediaItem | null;
  /** Width over height of the post's shape. */
  ratio: number;
  /** A lone video: shown whole on black, the way the Reels player does. */
  reel?: boolean;
  onZoom: () => void;
  empty: React.ReactNode;
}) {
  return (
    <div className="flex w-full justify-center bg-muted/60">
      <div
        className="relative overflow-hidden bg-muted"
        // The exact shape, as wide as the sheet allows and never taller
        // than most of the screen, so what is seen is the crop that posts.
        style={{
          aspectRatio: String(ratio),
          width: `min(100%, calc(60vh * ${ratio}))`,
        }}
      >
        {!item ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            {empty}
          </div>
        ) : item.kind === "video" ? (
          // biome-ignore lint/a11y/useMediaCaption: our own footage; the captions are the post's text
          <video
            key={item.url}
            src={item.url}
            poster={item.cover ?? undefined}
            controls
            playsInline
            preload="metadata"
            className={`h-full w-full bg-black ${reel ? "object-contain" : "object-cover"}`}
          />
        ) : (
          <button
            type="button"
            onClick={onZoom}
            className="block h-full w-full"
            aria-label="See it full size"
          >
            <img src={item.url} alt="" className="h-full w-full object-cover" />
          </button>
        )}
      </div>
    </div>
  );
}

function Thumb({ item }: { item: MediaItem }) {
  if (item.kind === "image")
    return (
      <img
        src={item.url}
        alt=""
        draggable={false}
        className="h-full w-full object-cover"
      />
    );
  return item.cover ? (
    <img
      src={item.cover}
      alt=""
      draggable={false}
      className="h-full w-full object-cover"
    />
  ) : (
    <video
      src={`${item.url}#t=0.5`}
      muted
      playsInline
      preload="metadata"
      className="pointer-events-none h-full w-full object-cover"
    />
  );
}

export function Strip({
  items,
  ratio,
  pending,
  drawing = 0,
  busyAt,
  selected,
  onSelect,
  onMove,
  onUpload,
  onDraw,
}: {
  items: MediaItem[];
  ratio: number;
  pending: Pending[];
  drawing?: number;
  busyAt?: Map<number, string>;
  selected: number;
  onSelect: (i: number) => void;
  onMove: (from: number, to: number) => void;
  onUpload: (files: File[]) => void;
  onDraw?: () => void;
}) {
  const [from, setFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const full = items.length + pending.length + drawing >= 10;
  const tile =
    "relative h-[70px] shrink-0 overflow-hidden rounded-md border bg-muted";
  // 70px tall and as wide as the post's shape; the add tiles stay 56px.
  const shaped = {
    width: `${Math.round(Math.min(134, Math.max(40, 70 * ratio)))}px`,
  };
  const fixed = { width: "56px" };

  return (
    <div className="flex gap-1.5 overflow-x-auto px-5 py-3 [scrollbar-width:thin]">
      {items.map((item, i) => (
        <button
          key={`${item.url}-${i}`}
          type="button"
          draggable
          onDragStart={() => setFrom(i)}
          onDragEnd={() => {
            setFrom(null);
            setOver(null);
          }}
          onDragOver={e => {
            if (from === null) return;
            e.preventDefault();
            setOver(i);
          }}
          onDrop={e => {
            e.preventDefault();
            if (from !== null && from !== i) onMove(from, i);
            setFrom(null);
            setOver(null);
          }}
          onClick={() => onSelect(i)}
          aria-label={`${item.kind === "video" ? "Video" : "Picture"} ${i + 1}${item.source === "ai" ? ", drawn by AI" : ""}`}
          aria-pressed={i === selected}
          style={shaped}
          className={`${tile} ${
            i === selected
              ? "ring-2 ring-primary ring-offset-1 ring-offset-background"
              : ""
          } ${over === i && from !== i ? "outline outline-2 outline-primary" : ""} ${
            from === i ? "opacity-40" : ""
          } cursor-grab active:cursor-grabbing`}
        >
          <Thumb item={item} />
          {item.kind === "video" ? (
            <Play className="absolute bottom-1 left-1 h-3 w-3 fill-white text-white drop-shadow" />
          ) : null}
          {item.source === "ai" ? (
            <Sparkles className="absolute right-1 top-1 h-3 w-3 text-white drop-shadow" />
          ) : null}
          {busyAt?.has(i) ? (
            <span className="absolute inset-0 flex items-center justify-center bg-black/45">
              <LoaderCircle className="h-4 w-4 animate-spin text-white" />
            </span>
          ) : null}
        </button>
      ))}

      {pending.map(p => (
        <div key={p.id} className={tile} style={shaped} title={p.name}>
          {p.kind === "image" ? (
            <img
              src={p.preview}
              alt=""
              className="h-full w-full object-cover opacity-60"
            />
          ) : (
            <video
              src={p.preview}
              muted
              preload="metadata"
              className="h-full w-full object-cover opacity-60"
            />
          )}
          <span className="absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-black/30">
            <span
              className="block h-full bg-primary transition-[width]"
              style={{ width: `${Math.round(p.share * 100)}%` }}
            />
          </span>
        </div>
      ))}

      {Array.from({ length: drawing }, (_, i) => (
        <div
          key={`d${i}`}
          className={`${tile} flex items-center justify-center`}
          style={shaped}
        >
          <Sparkles className="h-4 w-4 animate-pulse text-muted-foreground" />
        </div>
      ))}

      {!full ? (
        <>
          <label
            style={fixed}
            className={`${tile} flex cursor-pointer flex-col items-center justify-center gap-1 border-dashed bg-transparent text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-within:ring-2 focus-within:ring-ring`}
          >
            <Upload className="h-4 w-4" />
            Upload
            <input
              type="file"
              multiple
              accept={ACCEPT}
              className="sr-only"
              onChange={e => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length) onUpload(files);
              }}
            />
          </label>
          {onDraw ? (
            <button
              type="button"
              onClick={onDraw}
              style={fixed}
              className={`${tile} flex flex-col items-center justify-center gap-1 border-dashed bg-transparent text-xs text-muted-foreground hover:bg-muted hover:text-foreground`}
            >
              <Sparkles className="h-4 w-4" />
              Draw
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const FIELDS: Record<
  "bold" | "showcase",
  { key: keyof Words; label: string; hint: string }[]
> = {
  bold: [
    { key: "headline", label: "Headline", hint: "Two to six words: the hook." },
    { key: "line", label: "Under it", hint: "Optional, up to nine words." },
    {
      key: "accent",
      label: "Word in the accent colour",
      hint: "One word of the headline, exactly.",
    },
  ],
  showcase: [
    {
      key: "title",
      label: "Title",
      hint: "The project or the idea, two to four words.",
    },
    {
      key: "line",
      label: "Line",
      hint: "What and where, or what this slide shows.",
    },
    {
      key: "cta",
      label: "Footer offer",
      hint: "Three or four words, e.g. a free consultation.",
    },
  ],
};

/**
 * The words on the picture, where a person can read and fix them.
 *
 * Project words are set in type, so saving sets them again in seconds.
 * Bold words are drawn into the picture, so saving draws it again. The
 * read-back sits here too: when the drawn letters did not match, it says
 * what was read, so nobody has to squint at the picture to find it.
 */
function WordsPanel({
  postId,
  index,
  item,
  look,
  busy,
  onChanged,
}: {
  postId: string;
  index: number;
  item: MediaItem;
  look: Look;
  busy: string | undefined;
  onChanged: () => Promise<void>;
}) {
  const setWords = useAction(api.social.setWords);
  const addWords = useAction(api.social.addWords);
  const kind: "bold" | "showcase" =
    item.look ??
    (look === "bold" && item.source === "ai" ? "bold" : "showcase");
  const [draft, setDraft] = useState<Words>(item.words ?? {});
  const [saving, setSaving] = useState(false);
  // Words that arrive from Salma (or another screen) replace the draft.
  const wordsKey = JSON.stringify(item.words ?? {});
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the words' content
  useEffect(() => {
    setDraft(item.words ?? {});
  }, [wordsKey]);
  const changed = FIELDS[kind].some(
    f => (draft[f.key] ?? "").trim() !== (item.words?.[f.key] ?? "").trim(),
  );

  if (item.kind === "video") {
    if (!item.from) return null;
    const shot = [item.motion?.camera, item.motion?.person, item.motion?.motion]
      .filter(Boolean)
      .join(" · ");
    return (
      <p className="px-5 pb-2 pt-1 text-xs text-muted-foreground">
        Made to move from the picture; the words stay still on top.
        {shot ? ` ${shot}` : ""}
      </p>
    );
  }

  async function save() {
    setSaving(true);
    try {
      await setWords({ postId, index, words: draft });
      toast.success(
        kind === "bold"
          ? "Drawing it again with these words. It takes a couple of minutes."
          : "Setting the words. It takes a few seconds.",
      );
      await onChanged();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setSaving(false);
    }
  }

  if (!item.words) {
    // A bold picture gets its words when it is drawn; a project picture or
    // our own photo can have them set in type now.
    if (look === "plain" || (kind === "bold" && item.source === "ai"))
      return null;
    return (
      <div className="px-5 pb-2 pt-1">
        <button
          type="button"
          disabled={Boolean(busy) || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await addWords({ postId, index });
              toast.success("Writing the words. It takes about a minute.");
              await onChanged();
            } catch (e) {
              toast.error(message(e));
            } finally {
              setSaving(false);
            }
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {busy === "words" ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Type className="h-3.5 w-3.5" />
          )}
          {busy === "words" ? "Writing the words" : "Add words"}
        </button>
      </div>
    );
  }

  const rb = item.readback;
  return (
    <div className="mx-5 mb-2 mt-1 rounded-lg border px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Words on the picture</span>
        <span className="text-xs text-muted-foreground">
          {kind === "bold"
            ? "Drawn into the picture"
            : "Set in type, fixable in seconds"}
        </span>
      </div>
      {rb?.ok === false ? (
        <p className="tone-bad mb-2 flex gap-1.5 rounded-lg px-2.5 py-2 text-xs">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The letters may be wrong on this picture:{" "}
            {(rb.missing ?? []).map(m => (
              <span key={m}>
                «<bdi>{m}</bdi>»{" "}
              </span>
            ))}
            did not read back as written
            {rb.seen ? (
              <>
                {" "}
                (it reads «<bdi>{rb.seen.replace(/\s+/g, " ")}</bdi>»)
              </>
            ) : null}
            . Fix the words or draw it again.
          </span>
        </p>
      ) : rb?.ok === null ? (
        <p className="mb-2 text-xs text-muted-foreground">
          The words were not read back{rb.error ? `: ${rb.error}` : ""}. Check
          them by eye.
        </p>
      ) : rb?.ok === true && kind === "bold" ? (
        // Tested 2026-09-24: the reader finds a missing or wrong word, but
        // no model tried saw a doubled letter's missing dots.
        <p className="mb-2 text-xs text-muted-foreground">
          Every word read back. A single missing dot can still get past the
          check, so look at the letters before sending.
        </p>
      ) : null}
      <div className="space-y-2">
        {FIELDS[kind].map(f => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-xs text-muted-foreground">
              {f.label}
            </span>
            <input
              dir="auto"
              value={draft[f.key] ?? ""}
              placeholder={f.hint}
              onChange={e => setDraft({ ...draft, [f.key]: e.target.value })}
              className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
            />
          </label>
        ))}
      </div>
      {changed ? (
        <div className="mt-2.5 flex justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setDraft(item.words ?? {})}
            className="h-8 rounded-lg px-2.5 text-xs text-muted-foreground hover:bg-muted"
          >
            Undo
          </button>
          <button
            type="button"
            disabled={saving || Boolean(busy)}
            onClick={() => void save()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {kind === "bold" ? "Save and draw again" : "Save words"}
          </button>
        </div>
      ) : busy === "words" ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Setting the
          words
        </p>
      ) : null}
    </div>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

/** The media of a post that exists: every change is saved as it is made. */
export function MediaEditor({
  post,
  clientId,
  jobs,
  onChanged,
  look = "bold",
}: {
  post: {
    id: string;
    slides: number;
    aspect?: string | null;
    media?: MediaItem[] | null;
    images?: string[] | null;
    error: string | null;
  };
  clientId: string;
  jobs: Job[];
  onChanged: () => Promise<void>;
  /** How this client's pictures carry words. */
  look?: Look;
}) {
  const setMedia = useAction(api.social.setMedia);
  const draw = useAction(api.social.generatePost);
  const cover = useAction(api.social.makeCover);
  const moveIt = useAction(api.social.makeItMove);
  const { pending, upload } = useUploader(clientId);

  const [override, setOverride] = useState<MediaItem[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [zoom, setZoom] = useState(false);
  const items = override ?? itemsOf(post);
  // Uploads finish after the list may have changed; they append to what
  // is there when they land, not to what was there when they started.
  const latest = useRef(items);
  latest.current = items;

  useEffect(() => {
    if (selected > Math.max(0, items.length - 1))
      setSelected(Math.max(0, items.length - 1));
  }, [items.length, selected]);

  // What is in flight on this post, from the jobs the month carries.
  const busyAt = new Map<number, string>();
  let drawing = 0;
  for (const j of jobs) {
    const i = j.params?.index;
    if (j.kind === "cover" && i !== undefined) busyAt.set(i, "cover");
    if (j.kind === "words" && i !== undefined) busyAt.set(i, "words");
    if (j.kind === "motion" && i !== undefined) busyAt.set(i, "motion");
    if (j.kind !== "generate") continue;
    if (i !== undefined) busyAt.set(i, "draw");
    else if (j.params?.add) drawing++;
    else if (items.some(m => m.source === "ai"))
      items.forEach((m, k) => {
        if (m.source === "ai") busyAt.set(k, "draw");
      });
    else drawing += Math.max(1, post.slides - items.length);
  }

  async function save(next: MediaItem[]) {
    setOverride(next);
    try {
      await setMedia({ postId: post.id, media: next });
      await onChanged();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setOverride(null);
    }
  }

  async function add(files: File[]) {
    const got = await upload(files);
    if (!got.length) return;
    const room = 10 - latest.current.length;
    if (got.length > room)
      toast.error(
        `Instagram takes ten items at most, so ${got.length - room} of them were left out.`,
      );
    const next = [...latest.current, ...got.slice(0, Math.max(0, room))];
    await save(next);
    setSelected(next.length - 1);
  }

  async function queue(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      toast.success(done);
      await onChanged();
    } catch (e) {
      toast.error(message(e));
    }
  }

  const item = items[selected] ?? null;
  const busy = busyAt.get(selected);
  const ratio = ratioOf(post.aspect, items);
  const reel = items.length === 1 && items[0].kind === "video";

  return (
    <div>
      <Stage
        item={item}
        ratio={ratio}
        reel={reel}
        onZoom={() => setZoom(true)}
        empty={
          drawing ? (
            <>
              <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                The pictures are being drawn. It takes a couple of minutes.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing on this post yet. Upload photos or a video, or draw one
              with AI.
            </p>
          )
        }
      />
      <Strip
        items={items}
        ratio={ratio}
        pending={pending}
        drawing={drawing}
        busyAt={busyAt}
        selected={selected}
        onSelect={setSelected}
        onMove={(a, b) => {
          void save(move(items, a, b));
          setSelected(b);
        }}
        onUpload={files => void add(files)}
        onDraw={() =>
          void queue(
            () => draw({ postId: post.id, add: true }),
            "Drawing one more picture. It takes a couple of minutes.",
          )
        }
      />

      {item ? (
        <div className="flex flex-wrap items-center gap-1.5 px-5 pb-1">
          {item.source === "ai" && item.kind === "image" ? (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() =>
                void queue(
                  () => draw({ postId: post.id, index: selected }),
                  "Drawing this one again. It takes a couple of minutes.",
                )
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {busy === "draw" ? "Drawing again" : "Draw again"}
            </button>
          ) : null}
          {item.kind === "image" && !(item.look === "bold" && item.words) ? (
            <button
              type="button"
              disabled={Boolean(busy)}
              title={
                items.length === 1
                  ? "Becomes a Reel: the picture moves a little, the words stay still."
                  : "Becomes a video in the carousel, in the post's shape; the words stay still."
              }
              onClick={() =>
                void queue(
                  () => moveIt({ postId: post.id, index: selected }),
                  "Making it move. It takes two or three minutes.",
                )
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              {busy === "motion" ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Clapperboard className="h-3.5 w-3.5" />
              )}
              {busy === "motion" ? "Making it move" : "Make it move"}
            </button>
          ) : null}
          {item.kind === "video" ? (
            <>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void queue(
                    () => cover({ postId: post.id, index: selected }),
                    "Making the cover from the video. It takes a couple of minutes.",
                  )
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                {busy === "cover" ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {busy === "cover"
                  ? "Making the cover"
                  : item.cover
                    ? "Make another cover"
                    : "Make a cover"}
              </button>
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
                <ImageUp className="h-3.5 w-3.5" />
                Upload a cover
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    const at = selected;
                    void (async () => {
                      const [got] = await upload([file], "image");
                      if (!got) return;
                      await save(
                        latest.current.map((m, k) =>
                          k === at ? { ...m, cover: got.url } : m,
                        ),
                      );
                    })();
                  }}
                />
              </label>
              {item.cover ? (
                <a
                  href={item.cover}
                  target="_blank"
                  rel="noreferrer"
                  title="The cover"
                  className="h-8 w-[18px] overflow-hidden rounded-sm border"
                >
                  <img
                    src={item.cover}
                    alt="The cover"
                    className="h-full w-full object-cover"
                  />
                </a>
              ) : null}
            </>
          ) : null}
          <span className="ml-auto inline-flex items-center gap-0.5">
            <button
              type="button"
              aria-label="Move it earlier"
              disabled={selected === 0}
              onClick={() => {
                void save(move(items, selected, selected - 1));
                setSelected(selected - 1);
              }}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Move it later"
              disabled={selected >= items.length - 1}
              onClick={() => {
                void save(move(items, selected, selected + 1));
                setSelected(selected + 1);
              }}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Take it off the post"
              onClick={() => {
                const before = items;
                void save(items.filter((_, k) => k !== selected));
                toast("Taken off the post.", {
                  action: { label: "Undo", onClick: () => void save(before) },
                });
              }}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </span>
        </div>
      ) : null}

      {item ? (
        <WordsPanel
          key={`${post.id}:${selected}:${item.url}`}
          postId={post.id}
          index={selected}
          item={item}
          look={look}
          busy={busy}
          onChanged={onChanged}
        />
      ) : null}

      {zoom && item?.kind === "image" ? (
        <button
          type="button"
          aria-label="Close the picture"
          onClick={() => setZoom(false)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-6"
        >
          <img
            src={item.url}
            alt=""
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </button>
      ) : null}
    </div>
  );
}

/** Items for a post not made yet: held here until "Create the post". */
export function DraftMedia({
  clientId,
  aspect,
  items,
  onChange,
  onUploading,
}: {
  clientId: string;
  aspect: string;
  items: MediaItem[];
  onChange: (next: MediaItem[]) => void;
  /** How many files are still on their way, so the post waits for them. */
  onUploading?: (n: number) => void;
}) {
  const { pending, upload } = useUploader(clientId);
  useEffect(() => {
    onUploading?.(pending.length);
  }, [pending.length, onUploading]);
  const [selected, setSelected] = useState(0);
  const latest = useRef(items);
  latest.current = items;
  const item = items[Math.min(selected, items.length - 1)] ?? null;
  const ratio = ratioOf(aspect, items);

  async function add(files: File[]) {
    const got = await upload(files);
    if (!got.length) return;
    const room = 10 - latest.current.length;
    if (got.length > room)
      toast.error(
        `Instagram takes ten items at most, so ${got.length - room} of them were left out.`,
      );
    const next = [...latest.current, ...got.slice(0, Math.max(0, room))];
    onChange(next);
    setSelected(next.length - 1);
  }

  return (
    <div className="overflow-hidden rounded-xl border">
      {items.length || pending.length ? (
        <Stage
          item={item}
          ratio={ratio}
          reel={items.length === 1 && items[0].kind === "video"}
          onZoom={() => {}}
          empty={
            <>
              <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Uploading</p>
            </>
          }
        />
      ) : (
        <label className="flex aspect-[4/5] max-h-[50vh] w-full cursor-pointer flex-col items-center justify-center gap-2 bg-muted/40 px-8 text-center hover:bg-muted focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring">
          <Upload className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium">Add photos or a video</span>
          <span className="text-xs text-muted-foreground">
            One photo is a post, one video is a Reel, several make a carousel.
            Up to ten.
          </span>
          <input
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            onChange={e => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) void add(files);
            }}
          />
        </label>
      )}
      {items.length || pending.length ? (
        <>
          <Strip
            items={items}
            ratio={ratio}
            pending={pending}
            selected={selected}
            onSelect={setSelected}
            onMove={(a, b) => {
              onChange(move(items, a, b));
              setSelected(b);
            }}
            onUpload={files => void add(files)}
          />
          {item ? (
            <div className="flex justify-end px-3 pb-2">
              <button
                type="button"
                aria-label="Take it off"
                onClick={() => onChange(items.filter((_, k) => k !== selected))}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
