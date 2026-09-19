import { useMemo, useState } from "react";
import AdPreviewFrame from "../components/AdPreview";
import { Empty, Fold, Out, Problem, Prose, Spinner } from "../components/bits";
import { useSwipe } from "../lib/data";
import { clock } from "../lib/format";
import type { SwipeAd } from "../lib/types";

/**
 * The swipe file, from Foreplay.
 *
 * Saving happens in their Chrome extension; their API is read-only, so
 * nothing can be pushed in. The worker mirrors it here, which means the
 * cockpit needs no Foreplay key in the browser, the board still reads when
 * Foreplay is down, and if the subscription ever lapses the ads we already
 * saw are still ours.
 *
 * Sorted by days on air, because that is the strongest single signal that an
 * ad is working, and it is the one thing the Meta Ad Library will not tell
 * you once the ad stops.
 */
function Card({ ad }: { ad: SwipeAd }) {
  const days = ad.running_duration;
  return (
    <li className="panel overflow-hidden">
      <div className="grid gap-3 p-3 sm:grid-cols-[11rem_1fr]">
        <div className="max-w-44">
          {ad.video ? (
            <video
              src={ad.video}
              poster={ad.thumbnail ?? undefined}
              controls
              preload="none"
              playsInline
              className="raised aspect-[4/5] w-full rounded-[var(--radius-md)] object-cover"
            >
              <track kind="captions" />
            </video>
          ) : (
            <AdPreviewFrame
              adId={ad.ad_id ?? ad.id}
              title={ad.name ?? "Saved ad"}
              thumbUrl={ad.thumbnail ?? ad.image}
            />
          )}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <p className="truncate text-sm font-medium">{ad.name ?? "Untitled"}</p>
            {ad.board_name ? <span className="muted text-xs">{ad.board_name}</span> : null}
          </div>

          <p className="muted mt-1 flex flex-wrap gap-x-3 text-xs tabular-nums">
            {days ? (
              <span
                style={{ color: days >= 60 ? "var(--success)" : undefined }}
                title="days on air"
              >
                {days} days on air
              </span>
            ) : null}
            {ad.live === false ? <span>stopped</span> : null}
            {ad.video_duration ? <span>{clock(ad.video_duration)}</span> : null}
            {ad.display_format ? <span>{ad.display_format}</span> : null}
            {(ad.languages ?? []).length ? <span>{(ad.languages ?? []).join(", ")}</span> : null}
          </p>

          {ad.headline ? (
            <p dir="auto" className="rtl-safe mt-2 text-sm">
              {ad.headline}
            </p>
          ) : null}

          <p className="muted mt-2 flex flex-wrap gap-x-3 text-xs">
            {ad.foreplay_url ? <Out href={ad.foreplay_url}>Open in Foreplay</Out> : null}
            {ad.link_url ? <Out href={ad.link_url}>Where it sent people</Out> : null}
          </p>
        </div>
      </div>

      {ad.description || ad.full_transcription ? (
        <div className="px-3 pb-1">
          {ad.description ? (
            <Fold title="Ad copy">
              <Prose text={ad.description} />
            </Fold>
          ) : null}
          {ad.full_transcription ? (
            <Fold title="What is said in it" hint={`${ad.full_transcription.length} characters`}>
              <Prose text={ad.full_transcription} />
            </Fold>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function SwipePage() {
  const swipe = useSwipe();
  const [board, setBoard] = useState("");
  const [longRunning, setLongRunning] = useState(false);

  const boards = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of swipe.data ?? []) {
      const key = a.board_name ?? "Unsorted";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [swipe.data]);

  const shown = useMemo(() => {
    let rows = swipe.data ?? [];
    if (board) rows = rows.filter((a) => (a.board_name ?? "Unsorted") === board);
    if (longRunning) rows = rows.filter((a) => (a.running_duration ?? 0) >= 60);
    return rows;
  }, [swipe.data, board, longRunning]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Swipe file</h1>
        <p className="muted mt-1 text-sm">
          Ads saved in Foreplay, longest-running first. An ad still on air after two months is
          working, which is the one thing the Meta Ad Library stops telling you once it ends.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setBoard("")}
          aria-pressed={board === ""}
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${
            board === ""
              ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
              : "raised muted"
          }`}
        >
          All {swipe.data?.length ? `(${swipe.data.length})` : ""}
        </button>
        {boards.slice(0, 12).map(([name, n]) => (
          <button
            key={name}
            type="button"
            onClick={() => setBoard(name)}
            aria-pressed={board === name}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              board === name
                ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
                : "raised muted"
            }`}
          >
            {name} <span className="tabular-nums opacity-70">{n}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setLongRunning((v) => !v)}
          aria-pressed={longRunning}
          className={`ml-auto rounded-full px-3 py-1.5 text-xs font-medium ${
            longRunning
              ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
              : "raised muted"
          }`}
        >
          On air 60+ days
        </button>
      </div>

      {swipe.error && <Problem>The swipe file could not be read: {swipe.error}</Problem>}
      {swipe.loading && <Spinner what="Reading the swipe file" />}
      {!swipe.loading && !shown.length && (
        <Empty>
          Nothing saved yet. Ads land here from the Foreplay extension once the key is set on the
          worker.
        </Empty>
      )}

      <ul className="space-y-3">
        {shown.map((ad) => (
          <Card key={ad.id} ad={ad} />
        ))}
      </ul>
    </div>
  );
}
