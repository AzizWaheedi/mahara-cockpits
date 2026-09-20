import { Images as Carousel, Image as Single } from "lucide-react";
import { useMemo, useState } from "react";

/**
 * The month, as days.
 *
 * Built after looking at what the tools agencies actually use do well.
 * Later's win is the visual grid -- seeing the feed as it will look
 * beats a list of rows. Planable's is the audit trail: every action
 * against a name and a time. Buffer's is that the calendar has no
 * learning curve. So: a plain month grid, click a post then click a day,
 * and a feed preview beside it.
 *
 * Click-to-place rather than drag-and-drop on purpose. Dragging is nicer
 * for two seconds and worse for everything else: it breaks on touch, it
 * is unusable from a keyboard, and a misdrop silently moves a client's
 * post to the wrong day.
 */
export type CalPost = {
  id: string;
  n: number;
  pillar: string;
  topic: string | null;
  slides: number;
  images: string[] | null;
  scheduled_at: string | null;
  status: string;
};

const PILLAR_DOT: Record<string, string> = {
  portfolio: "var(--primary)",
  craft: "var(--success)",
  education: "var(--warning)",
};

/** Two or more images is a carousel. One is an image. Instagram's rule. */
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

/** Monday-first, which is how a Gulf working week is read here. */
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

function Chip({
  post,
  selected,
  onClick,
}: {
  post: CalPost;
  selected: boolean;
  onClick: () => void;
}) {
  const carousel = isCarousel(post);
  const cover = post.images?.[0];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={`${post.pillar} · ${carousel ? `carousel, ${post.images?.length ?? post.slides} slides` : "single image"}\n${post.topic ?? ""}`}
      className={`relative flex w-full items-center gap-1 rounded border px-1 py-0.5 text-left text-[10px] leading-tight transition ${
        selected
          ? "border-foreground bg-foreground text-background"
          : "hover:bg-muted"
      }`}
    >
      {cover ? (
        <img
          src={cover}
          alt=""
          className="h-4 w-4 shrink-0 rounded-sm object-cover"
        />
      ) : (
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{
            background: PILLAR_DOT[post.pillar] ?? "var(--muted-foreground)",
          }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">
        {post.topic ?? `Post ${post.n}`}
      </span>
      {carousel ? (
        <span className="flex shrink-0 items-center gap-0.5 opacity-70">
          <Carousel className="h-2.5 w-2.5" />
          {post.images?.length ?? post.slides}
        </span>
      ) : (
        <Single className="h-2.5 w-2.5 shrink-0 opacity-50" />
      )}
    </button>
  );
}

export function SocialCalendar({
  month,
  posts,
  onPlace,
  busy,
}: {
  month: string;
  posts: CalPost[];
  onPlace: (postId: string, iso: string) => void;
  busy: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [showFeed, setShowFeed] = useState(false);

  const total = daysIn(month);
  const pad = firstWeekday(month);
  const byDay = useMemo(() => {
    const m = new Map<number, CalPost[]>();
    for (const p of posts) {
      const d = dayOf(p.scheduled_at);
      if (d) m.set(d, [...(m.get(d) ?? []), p]);
    }
    return m;
  }, [posts]);
  const unplaced = posts.filter(p => !dayOf(p.scheduled_at));

  function place(day: number) {
    if (!picked) return;
    // 10am Kuwait, which is 07:00 UTC. A day is a day; the hour is ours.
    const iso = new Date(
      Date.UTC(
        Number(month.slice(0, 4)),
        Number(month.slice(5, 7)) - 1,
        day,
        7,
        0,
        0,
      ),
    ).toISOString();
    onPlace(picked, iso);
    setPicked(null);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-[12px] font-semibold">Calendar</p>
        <span className="text-[12px] text-muted-foreground">
          {picked
            ? "now click the day it goes out"
            : unplaced.length
              ? `${unplaced.length} not placed yet`
              : "every post has a day"}
        </span>
        <button
          type="button"
          onClick={() => setShowFeed(v => !v)}
          aria-pressed={showFeed}
          className="ml-auto rounded border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted"
        >
          {showFeed ? "Calendar" : "Feed preview"}
        </button>
      </div>

      {unplaced.length ? (
        <div className="mb-2 flex flex-wrap gap-1 rounded-md border border-dashed p-1.5">
          {unplaced.map(p => (
            <span key={p.id} className="w-40">
              <Chip
                post={p}
                selected={picked === p.id}
                onClick={() => setPicked(picked === p.id ? null : p.id)}
              />
            </span>
          ))}
        </div>
      ) : null}

      {showFeed ? (
        /* Later's trick: the feed as it will look, newest first, which is
           the only way to notice three brown close-ups in a row. */
        <div className="grid grid-cols-3 gap-0.5">
          {[...posts]
            .sort((a, b) =>
              String(b.scheduled_at ?? "").localeCompare(
                String(a.scheduled_at ?? ""),
              ),
            )
            .map(p => (
              <div
                key={p.id}
                title={p.topic ?? ""}
                className="relative aspect-square overflow-hidden rounded-sm bg-muted"
              >
                {p.images?.[0] ? (
                  <img
                    src={p.images[0]}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span
                    className="absolute inset-0 opacity-30"
                    style={{
                      background:
                        PILLAR_DOT[p.pillar] ?? "var(--muted-foreground)",
                    }}
                  />
                )}
                {isCarousel(p) ? (
                  <Carousel className="absolute right-1 top-1 h-3 w-3 text-white drop-shadow" />
                ) : null}
              </div>
            ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-0.5 text-[10px]">
          {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(d => (
            <div
              key={d}
              className="pb-0.5 text-center font-semibold text-muted-foreground"
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
              <button
                key={day}
                type="button"
                disabled={!picked || busy}
                onClick={() => place(day)}
                className={`min-h-14 rounded border p-0.5 text-left align-top transition ${
                  picked
                    ? "cursor-pointer hover:border-foreground hover:bg-muted"
                    : ""
                } ${here.length ? "" : "border-dashed"}`}
              >
                <span className="block px-0.5 text-muted-foreground tabular-nums">
                  {day}
                </span>
                <span className="mt-0.5 flex flex-col gap-0.5">
                  {here.map(p => (
                    <Chip
                      key={p.id}
                      post={p}
                      selected={picked === p.id}
                      onClick={() => setPicked(picked === p.id ? null : p.id)}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Posts go out at 10am Kuwait. A day you set here is pushed to GoHighLevel
        too, so the two never disagree about when a client's post runs.
      </p>
    </div>
  );
}
