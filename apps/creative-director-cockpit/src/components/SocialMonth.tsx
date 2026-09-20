import {
  ImageIcon,
  Layers,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

/**
 * A month of a client's posts, as days with the pictures in them.
 *
 * The month is the page. Everything a post has -- its picture, its
 * caption, the prompts behind it -- opens beside the grid rather than
 * stacking a second list underneath it, because the old screen showed
 * the same twelve posts twice and neither copy had room to breathe.
 *
 * The cell is the picture. A day that has been illustrated shows the
 * image; a day that has not shows a thin spine in its pillar's colour.
 * Read down the month and you see what is actually going out, which is
 * the one thing a list of rows cannot show you.
 */

export type MonthPost = {
  id: string;
  n: number;
  pillar: string;
  topic: string | null;
  slides: number;
  caption: string | null;
  caption_direction: string | null;
  prompts: string[] | null;
  images: string[] | null;
  scheduled_at: string | null;
  status: string;
};

/** Pillar colour comes from the chart tokens, so a client's own names get one too. */
export function pillarColor(pillar: string, pillars: string[]): string {
  const i = Math.max(0, pillars.indexOf(pillar));
  return `var(--chart-${(i % 5) + 1})`;
}

/** Two or more images is a carousel; one is an image. Instagram's rule. */
export function isCarousel(p: {
  slides: number;
  images?: string[] | null;
}): boolean {
  return (p.images?.length ?? p.slides) > 1;
}

function daysIn(month: string): number {
  return new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
}

/** Monday first, which is how a Gulf working week is read. */
function firstWeekday(month: string): number {
  const d = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1),
  );
  return (d.getUTCDay() + 6) % 7;
}

function dayOf(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getUTCDate();
}

function dayIso(month: string, day: number): string {
  // 10am Kuwait is 07:00 UTC. The day is the decision; the hour is ours.
  return new Date(
    Date.UTC(
      Number(month.slice(0, 4)),
      Number(month.slice(5, 7)) - 1,
      day,
      7,
      0,
      0,
    ),
  ).toISOString();
}

function Cell({
  post,
  pillars,
  selected,
  onClick,
}: {
  post: MonthPost;
  pillars: string[];
  selected: boolean;
  onClick: () => void;
}) {
  const cover = post.images?.[0];
  const many = isCarousel(post);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={post.topic ?? undefined}
      className={`group relative block h-full w-full overflow-hidden rounded-md text-left ring-offset-2 ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selected ? "ring-2 ring-primary" : ""
      }`}
    >
      {cover ? (
        <img
          src={cover}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="block h-full w-full bg-muted/50" />
      )}
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: pillarColor(post.pillar, pillars) }}
      />
      <span
        className={`absolute inset-x-0 bottom-0 px-1.5 pb-1 pt-4 text-[11px] leading-tight ${
          cover
            ? "bg-gradient-to-t from-black/75 to-transparent text-white"
            : "text-foreground"
        }`}
      >
        <span className="line-clamp-2">{post.topic ?? "Untitled"}</span>
      </span>
      {many ? (
        <Layers
          className={`absolute right-1 top-1 h-3 w-3 ${cover ? "text-white drop-shadow" : "text-muted-foreground"}`}
        />
      ) : null}
    </button>
  );
}

export function SocialMonth({
  month,
  posts,
  pillars,
  busy,
  onPlace,
  onAdd,
  children,
}: {
  month: string;
  posts: MonthPost[];
  pillars: string[];
  busy: boolean;
  onPlace: (postId: string, iso: string) => void;
  onAdd: (
    pillar: string,
    topic: string,
    slides: number,
    iso: string | null,
    generate: boolean,
  ) => void;
  /** The detail panel for whichever post is open. */
  children: (post: MonthPost | null, close: () => void) => ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  /** The day being composed on: a number, or 0 for "no day yet". */
  const [adding, setAdding] = useState<number | null>(null);

  const total = daysIn(month);
  const pad = firstWeekday(month);
  const byDay = useMemo(() => {
    const m = new Map<number, MonthPost[]>();
    for (const p of posts) {
      const d = dayOf(p.scheduled_at);
      if (d) m.set(d, [...(m.get(d) ?? []), p]);
    }
    return m;
  }, [posts]);
  const unplaced = posts.filter(p => !dayOf(p.scheduled_at));
  const open = posts.find(p => p.id === openId) ?? null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div>
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold tracking-tight">
            {new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })}
          </h3>
          <span className="text-[12px] text-muted-foreground">
            {moving
              ? "Pick the day it goes out"
              : unplaced.length
                ? `${unplaced.length} without a day`
                : `${posts.length} posts`}
          </span>
          <button
            type="button"
            onClick={() => setAdding(adding === null ? 0 : null)}
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[12px] font-medium hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" />
            Add a post
          </button>
        </div>

        {adding !== null ? (
          <AddPost
            pillars={pillars}
            month={month}
            day={adding}
            busy={busy}
            onCancel={() => setAdding(null)}
            onAdd={(pillar, topic, slides, iso, generate) => {
              onAdd(pillar, topic, slides, iso, generate);
              setAdding(null);
            }}
          />
        ) : null}

        {unplaced.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5 rounded-lg border border-dashed p-2">
            {unplaced.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setOpenId(p.id);
                  setMoving(moving === p.id ? null : p.id);
                }}
                className={`inline-flex max-w-52 items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition ${
                  moving === p.id
                    ? "border-primary bg-primary/10"
                    : "hover:bg-muted"
                }`}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: pillarColor(p.pillar, pillars) }}
                />
                <span className="truncate">{p.topic ?? "Untitled"}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-7 gap-1">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
            <div
              key={d}
              className="pb-1 text-[11px] font-medium text-muted-foreground"
            >
              {d}
            </div>
          ))}
          {Array.from({ length: pad }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: blanks before the 1st
            <div key={`pad${i}`} />
          ))}
          {Array.from({ length: total }, (_, i) => i + 1).map(day => {
            const here = byDay.get(day) ?? [];
            return (
              <div
                key={day}
                className={`relative flex flex-col gap-1 rounded-lg border p-1 ${
                  here.length
                    ? "min-h-[7rem] bg-card"
                    : "min-h-[3.5rem] border-dashed"
                }`}
              >
                <div className="flex items-center justify-between px-0.5">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {day}
                  </span>
                  {moving ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        onPlace(moving, dayIso(month, day));
                        setMoving(null);
                      }}
                      className="rounded px-1 text-[11px] font-medium text-primary hover:bg-primary/10"
                    >
                      put here
                    </button>
                  ) : null}
                </div>
                {!here.length && !moving ? (
                  <button
                    type="button"
                    onClick={() => setAdding(day)}
                    aria-label={`Add a post on the ${day}`}
                    className="absolute inset-0 flex items-center justify-center rounded-lg text-muted-foreground opacity-0 transition hover:bg-muted/60 hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                ) : null}
                {here.map(p => (
                  <div key={p.id} className="min-h-[4.5rem] flex-1">
                    <Cell
                      post={p}
                      pillars={pillars}
                      selected={openId === p.id}
                      onClick={() => setOpenId(openId === p.id ? null : p.id)}
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <aside className="lg:sticky lg:top-4 lg:self-start">
        {children(open, () => setOpenId(null))}
      </aside>
    </div>
  );
}

function AddPost({
  pillars,
  month,
  day: startDay,
  busy,
  onAdd,
  onCancel,
}: {
  pillars: string[];
  month: string;
  /** The day clicked, or 0 when opened from the toolbar. */
  day: number;
  busy: boolean;
  onAdd: (
    pillar: string,
    topic: string,
    slides: number,
    iso: string | null,
    generate: boolean,
  ) => void;
  onCancel: () => void;
}) {
  const [pillar, setPillar] = useState(pillars[0] ?? "portfolio");
  const [topic, setTopic] = useState("");
  const [slides, setSlides] = useState(1);
  const [day, setDay] = useState(startDay ? String(startDay) : "");
  const iso = () =>
    day ? dayIso(month, Math.min(31, Math.max(1, Number(day)))) : null;
  return (
    <div className="mb-2.5 rounded-lg border bg-muted/20 p-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Pillar</span>
          <select
            value={pillar}
            onChange={e => setPillar(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-[12px]"
          >
            {pillars.map(p => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">
            What is it about
          </span>
          <input
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="A finished villa in Doha, elevation by elevation"
            className="h-8 rounded-md border bg-background px-2 text-[12px]"
          />
        </label>
        <label className="flex w-20 flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Slides</span>
          <input
            type="number"
            min={1}
            max={10}
            value={slides}
            onChange={e => setSlides(Number(e.target.value))}
            className="h-8 rounded-md border bg-background px-2 text-[12px]"
          />
        </label>
        <label className="flex w-28 flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Day</span>
          <input
            type="number"
            min={1}
            max={31}
            value={day}
            onChange={e => setDay(e.target.value)}
            placeholder="later"
            className="h-8 rounded-md border bg-background px-2 text-[12px]"
          />
        </label>
        <button
          type="button"
          disabled={busy || !topic.trim()}
          onClick={() => onAdd(pillar, topic, slides, iso(), true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Add and generate
        </button>
        <button
          type="button"
          disabled={busy || !topic.trim()}
          onClick={() => onAdd(pillar, topic, slides, iso(), false)}
          className="h-8 rounded-md border px-2.5 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
        >
          Add only
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** A picture at full size. Escape closes it, as it should anywhere else. */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <button
      type="button"
      aria-label="Close the picture"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
    >
      <img
        src={src}
        alt=""
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    </button>
  );
}

/** Everything about one post, beside the month rather than under it. */
export function PostPanel({
  post,
  pillars,
  busy,
  onClose,
  onGenerate,
  onRemove,
  onAttach,
}: {
  post: MonthPost | null;
  pillars: string[];
  busy: boolean;
  onClose: () => void;
  onGenerate: (postId: string) => void;
  onRemove: (postId: string) => void;
  onAttach: (postId: string, urls: string[]) => void;
}) {
  const [urls, setUrls] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);

  if (!post)
    return (
      <div className="rounded-lg border border-dashed p-5 text-[12px] text-muted-foreground">
        Pick a day to see the post, its pictures and the prompts behind them.
      </div>
    );

  const images = post.images ?? [];
  const prompts = post.prompts ?? [];

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-start gap-2 border-b p-3">
        <span
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: pillarColor(post.pillar, pillars) }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-snug">
            {post.topic ?? "Untitled"}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {post.pillar}
            {isCarousel(post)
              ? ` · carousel of ${images.length || post.slides}`
              : " · single image"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-3 p-3">
        {images.length ? (
          <div>
            <div className="grid grid-cols-3 gap-1">
              {images.map(u => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setZoom(u)}
                  className="aspect-square overflow-hidden rounded-md border"
                >
                  <img
                    src={u}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Kept in our own storage, so the link still works when GoHighLevel
              fetches it days from now.{" "}
              <a
                href={images[0]}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Open the file
              </a>
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-3 text-center">
            <ImageIcon className="mx-auto h-4 w-4 text-muted-foreground" />
            <p className="mt-1 text-[12px] text-muted-foreground">
              No pictures yet.{" "}
              {prompts.length
                ? `${prompts.length} ${prompts.length === 1 ? "prompt is" : "prompts are"} ready.`
                : "Generating writes the prompts first."}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => onGenerate(post.id)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[12px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {images.length ? (
              <RefreshCw className="h-3.5 w-3.5" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {images.length ? "Generate again" : "Generate pictures"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(post.id)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>

        {post.caption ? (
          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">
              Caption
            </p>
            <p
              className="whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-[12px]"
              dir="auto"
            >
              {post.caption}
            </p>
          </div>
        ) : null}

        {prompts.length ? (
          <details className="group">
            <summary className="cursor-pointer list-none text-[11px] font-medium text-muted-foreground hover:text-foreground">
              {prompts.length} image{" "}
              {prompts.length === 1 ? "prompt" : "prompts"}
            </summary>
            <ol className="mt-1.5 space-y-1">
              {prompts.map((t, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a slide is its position
                <li
                  key={i}
                  className="text-[11px] leading-relaxed text-muted-foreground"
                >
                  <span className="mr-1 font-mono">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
          </details>
        ) : null}

        <details>
          <summary className="cursor-pointer list-none text-[11px] font-medium text-muted-foreground hover:text-foreground">
            Add pictures made elsewhere
          </summary>
          <div className="mt-1.5 flex gap-1.5">
            <input
              value={urls}
              onChange={e => setUrls(e.target.value)}
              placeholder="Paste image URLs"
              className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-[12px]"
            />
            <button
              type="button"
              disabled={busy || !urls.trim()}
              onClick={() => {
                onAttach(
                  post.id,
                  urls
                    .split(/[\s,]+/)
                    .map(u => u.trim())
                    .filter(Boolean),
                );
                setUrls("");
              }}
              className="h-8 rounded-md border px-2.5 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
            >
              Attach
            </button>
          </div>
        </details>
      </div>

      {zoom ? <Lightbox src={zoom} onClose={() => setZoom(null)} /> : null}
    </div>
  );
}
