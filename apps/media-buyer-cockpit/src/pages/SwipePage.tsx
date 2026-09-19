import { useAction } from "convex/react";
import {
  ChevronRight,
  ExternalLink,
  ImageOff,
  Lightbulb,
  LoaderCircle,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../../convex/_generated/api";
import { BoardStrip, ForeplayLinks } from "../components/Foreplay";
import {
  clock,
  currentBoards,
  type ForeplayBoard,
  type SwipeAd,
} from "../lib/foreplay";

/**
 * The swipe file: what the team saved in Foreplay.
 *
 * Saving happens in Foreplay's extension and on their phones; their API is
 * read-only, so nothing can be pushed in. The worker mirrors it here, which
 * means no cockpit needs a Foreplay key, the board still reads when
 * Foreplay is down, and if the subscription ever lapses the ads we already
 * saw are still ours.
 *
 * Sorted by days on air, because that is the strongest single signal that
 * an ad is working, and it is the one thing the Meta Ad Library will not
 * tell you once the ad stops.
 *
 * This file is the same in all three cockpits; only the two data imports
 * above differ, because this one has no Convex and the other two have no
 * Supabase client. Change it in one and copy it.
 */
function serverMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const cut = raw
    .split("\n")[0]
    .replace(/^\[.*?]\s*/, "")
    .trim();
  return cut || "That did not go through.";
}

function Fold({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t py-1.5 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left text-[12px] font-semibold text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={`h-3 w-3 transition ${open ? "rotate-90" : ""}`}
          strokeWidth={2.5}
        />
        {title}
        {hint ? <span className="font-normal opacity-70">{hint}</span> : null}
      </button>
      {open ? (
        <p
          dir="auto"
          className="rtl-safe mt-1.5 whitespace-pre-wrap text-[13px]"
        >
          {children}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The loop that makes the subscription pay for itself: somebody saves an ad
 * on their phone, and one press puts it on the board everybody works from.
 * Nobody forwards a link.
 */
function SendToIdeation({
  ad,
  send,
}: {
  ad: SwipeAd;
  send: (args: { id: string }) => Promise<unknown>;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">(
    "idle",
  );
  const [why, setWhy] = useState<string | null>(null);

  if (state === "sent")
    return (
      <span className="text-[12px] text-muted-foreground">
        On the ideation board.
      </span>
    );

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={state === "sending"}
        onClick={async () => {
          setState("sending");
          try {
            await send({ id: ad.id });
            setState("sent");
          } catch (e) {
            setWhy(serverMessage(e));
            setState("failed");
          }
        }}
        className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <Lightbulb className="h-3 w-3" strokeWidth={2} />
        {state === "sending" ? "Sending" : "Send to ideation"}
      </button>
      {state === "failed" && why ? (
        <span className="text-[12px] text-muted-foreground">{why}</span>
      ) : null}
    </span>
  );
}

function Card({
  ad,
  send,
}: {
  ad: SwipeAd;
  send: (args: { id: string }) => Promise<unknown>;
}) {
  const days = ad.running_duration;
  const frame = ad.thumbnail ?? ad.image;
  return (
    <li className="overflow-hidden rounded-md border">
      <div className="grid gap-3 p-3 sm:grid-cols-[11rem_1fr]">
        <div className="max-w-44">
          {ad.video ? (
            // biome-ignore lint/a11y/useMediaCaption: a saved ad carries none
            <video
              src={ad.video}
              poster={frame ?? undefined}
              controls
              preload="none"
              playsInline
              className="aspect-[4/5] w-full rounded bg-muted object-cover"
            />
          ) : frame ? (
            <img
              src={frame}
              alt=""
              loading="lazy"
              className="aspect-[4/5] w-full rounded bg-muted object-cover"
            />
          ) : (
            <div className="flex aspect-[4/5] w-full items-center justify-center rounded bg-muted">
              <ImageOff className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <p className="truncate text-[13px] font-semibold">
              {ad.name ?? "Untitled"}
            </p>
            {ad.board_name ? (
              <span className="text-[12px] text-muted-foreground">
                {ad.board_name}
              </span>
            ) : null}
          </div>

          <p className="mt-1 flex flex-wrap gap-x-3 text-[12px] tabular-nums text-muted-foreground">
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
            {(ad.languages ?? []).length ? (
              <span>{(ad.languages ?? []).join(", ")}</span>
            ) : null}
          </p>

          {ad.headline ? (
            <p dir="auto" className="rtl-safe mt-2 text-[13px]">
              {ad.headline}
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px]">
            <SendToIdeation ad={ad} send={send} />
            {ad.foreplay_url ? (
              <a
                href={ad.foreplay_url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1 text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Open in Foreplay
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            {ad.link_url ? (
              <a
                href={ad.link_url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1 text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Where it sent people
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {ad.description || ad.full_transcription ? (
        <div className="px-3 pb-1">
          {ad.description ? (
            <Fold title="Ad copy">{ad.description}</Fold>
          ) : null}
          {ad.full_transcription ? (
            <Fold
              title="What is said in it"
              hint={`${ad.full_transcription.length} characters`}
            >
              {ad.full_transcription}
            </Fold>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function SwipePage() {
  const listAds = useAction(api.foreplay.ads);
  const listBoards = useAction(api.foreplay.boards);
  const toIdeation = useAction(api.foreplay.toIdeation);

  const alive = useRef(true);
  const [ads, setAds] = useState<SwipeAd[] | null>(null);
  const [boards, setBoards] = useState<ForeplayBoard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState("");
  const [longRunning, setLongRunning] = useState(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        listAds({ limit: 300 }),
        listBoards({}),
      ]);
      if (!alive.current) return;
      setAds(a as SwipeAd[]);
      setBoards(b as ForeplayBoard[]);
      setError(null);
    } catch (e) {
      if (alive.current) setError(serverMessage(e));
    }
  }, [listAds, listBoards]);

  useEffect(() => {
    void load();
  }, [load]);

  // Every board Foreplay had at the last sync, so adding one over there
  // shows up here even before anybody saves into it.
  const live = useMemo(() => currentBoards(boards), [boards]);

  const counts = useMemo(() => {
    const n = new Map<string, number>();
    for (const a of ads ?? [])
      if (a.board_id) n.set(a.board_id, (n.get(a.board_id) ?? 0) + 1);
    return n;
  }, [ads]);

  const shown = useMemo(() => {
    let rows = ads ?? [];
    if (board) rows = rows.filter(a => a.board_id === board);
    if (longRunning) rows = rows.filter(a => (a.running_duration ?? 0) >= 60);
    return rows;
  }, [ads, board, longRunning]);

  const fresh = live.filter(b => (counts.get(b.id) ?? 0) === 0 && b.ads === 0);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold tracking-tight">Swipe file</h2>
        <span className="text-[13px] text-muted-foreground">
          {ads ? `${ads.length} saved` : "Loading…"}
        </span>
      </div>
      <p className="mb-3 text-[13px] text-muted-foreground">
        Ads the team saved in Foreplay, longest-running first. An ad still on
        air after two months is working, which is the one thing the Meta Ad
        Library stops telling you once it ends. Send one to Ideation and
        everybody sees it.
      </p>

      {error ? (
        <div className="callout-bad mb-3 rounded-md border p-2 text-[13px]">
          {error}
        </div>
      ) : null}

      <ForeplayLinks />

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <BoardStrip
          boards={live}
          counts={counts}
          chosen={board}
          onChoose={setBoard}
          total={ads?.length ?? 0}
        />
        <button
          type="button"
          onClick={() => setLongRunning(v => !v)}
          aria-pressed={longRunning}
          className={`ml-auto rounded-full border px-3 py-1 text-[12px] font-semibold ${
            longRunning
              ? "border-transparent bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          On air 60+ days
        </button>
      </div>

      {fresh.length ? (
        <p className="mb-3 text-[12px] text-muted-foreground">
          Nothing saved yet on{" "}
          {fresh.map(b => b.name ?? "an untitled board").join(", ")}. Whatever
          the team puts there turns up here within twenty minutes.
        </p>
      ) : null}

      {!ads && !error ? (
        <p className="flex items-center gap-2 py-8 text-[13px] text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Reading the swipe file
        </p>
      ) : null}

      {ads && !shown.length ? (
        <p className="py-8 text-center text-[13px] text-muted-foreground">
          {board || longRunning
            ? "Nothing here matches that filter."
            : "Nothing saved yet. Ads land here from the Foreplay extension and from the team's phones."}
        </p>
      ) : null}

      <ul className="space-y-3">
        {shown.map(ad => (
          <Card key={ad.id} ad={ad} send={toIdeation} />
        ))}
      </ul>
    </div>
  );
}

export default SwipePage;
