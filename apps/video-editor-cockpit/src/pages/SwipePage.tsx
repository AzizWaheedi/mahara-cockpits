import { Lightbulb } from "lucide-react";
import { useMemo, useState } from "react";
import AdPreviewFrame from "../components/AdPreview";
import { Empty, Fold, Out, Problem, Prose, Spinner } from "../components/bits";
import { BoardStrip, currentBoards, ForeplayLinks } from "../components/Foreplay";
import { useWho } from "../lib/auth";
import { askFor, useBoards, useSwipe } from "../lib/data";
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
/**
 * The loop that makes the subscription pay for itself: somebody saves an ad
 * on their phone, and one press puts it on the board the creative director
 * works from. Nobody forwards a link.
 */
function SendToIdeation({ ad }: { ad: SwipeAd }) {
  const { email, name } = useWho();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [why, setWhy] = useState<string | null>(null);

  async function send() {
    setState("sending");
    const err = await askFor("toideation", `idea:${ad.id}`, ad.id, { email, name });
    if (err) {
      setWhy(err);
      setState("failed");
    } else {
      setState("sent");
    }
  }

  if (state === "sent") return <span className="muted text-xs">On the ideation board.</span>;

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={state === "sending"}
        onClick={send}
        className="raised flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium disabled:opacity-50"
      >
        <Lightbulb className="size-3" strokeWidth={2} />
        {state === "sending" ? "Sending" : "Send to ideation"}
      </button>
      {state === "failed" && why ? <span className="muted text-xs">{why}</span> : null}
    </span>
  );
}

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

          <div className="muted mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <SendToIdeation ad={ad} />
            {ad.foreplay_url ? <Out href={ad.foreplay_url}>Open in Foreplay</Out> : null}
            {ad.link_url ? <Out href={ad.link_url}>Where it sent people</Out> : null}
          </div>
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
  const boards = useBoards();
  const [board, setBoard] = useState("");
  const [longRunning, setLongRunning] = useState(false);

  // Every board Foreplay had at the last sync, in name order, so adding one
  // over there shows up here even before anybody saves into it.
  const live = useMemo(() => currentBoards(boards.data), [boards.data]);

  const counts = useMemo(() => {
    const n = new Map<string, number>();
    for (const a of swipe.data ?? []) {
      if (a.board_id) n.set(a.board_id, (n.get(a.board_id) ?? 0) + 1);
    }
    return n;
  }, [swipe.data]);

  const shown = useMemo(() => {
    let rows = swipe.data ?? [];
    if (board) rows = rows.filter((a) => a.board_id === board);
    if (longRunning) rows = rows.filter((a) => (a.running_duration ?? 0) >= 60);
    return rows;
  }, [swipe.data, board, longRunning]);

  const fresh = live.filter((b) => (counts.get(b.id) ?? 0) === 0 && b.ads === 0);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Swipe file</h1>
        <p className="muted mt-1 text-sm">
          Ads saved in Foreplay, longest-running first. An ad still on air after two months is
          working, which is the one thing the Meta Ad Library stops telling you once it ends.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <ForeplayLinks />
        <button
          type="button"
          onClick={() => setLongRunning((v) => !v)}
          aria-pressed={longRunning}
          className={`ml-auto rounded-full px-3 py-1.5 text-[12px] font-semibold ${
            longRunning
              ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
              : "raised muted"
          }`}
        >
          On air 60+ days
        </button>
      </div>

      <div className="mb-5">
        <BoardStrip
          boards={live}
          counts={counts}
          chosen={board}
          onChoose={setBoard}
          total={swipe.data?.length ?? 0}
        />
        {fresh.length ? (
          <p className="muted mt-2 text-xs">
            Nothing saved yet on {fresh.map((b) => b.name ?? "an untitled board").join(", ")}.
            Whatever the team puts there turns up here within twenty minutes.
          </p>
        ) : null}
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
