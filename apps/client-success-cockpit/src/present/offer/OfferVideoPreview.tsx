import "./searchExamples.css";
import { Play } from "lucide-react";
import { useState } from "react";
import type { VideoRow } from "../sources";
import { FRAME_ALLOW, FRAME_SANDBOX, usePlayerFrame } from "../VideoPlayer";

function Playing({ row }: { row: VideoRow }) {
  const player = usePlayerFrame(row, true);
  return (
    <div className="dkov-player">
      {player.src && player.phase !== "failed" && player.phase !== "blocked" ? (
        <iframe
          ref={player.frame}
          src={player.src}
          title={row.title ?? "Offer video"}
          sandbox={FRAME_SANDBOX}
          allow={FRAME_ALLOW}
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={player.onLoad}
        />
      ) : (
        <p>
          This video could not play here.{" "}
          <a href={row.url} target="_blank" rel="noreferrer">
            Open recording
          </a>
        </p>
      )}
      {player.slow && player.phase === "loading" ? (
        <p role="status">Loading video…</p>
      ) : null}
    </div>
  );
}

/** Mount only on a deliberate play, so opening the library never starts several videos. */
export function OfferVideoPreview({ row }: { row: VideoRow }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="dkov-preview">
      {playing ? (
        <>
          <Playing row={row} />
          <button type="button" onClick={() => setPlaying(false)}>
            Close video
          </button>
        </>
      ) : (
        <button
          className="dkov-poster"
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play ${row.title ?? "offer video"}`}
        >
          {row.posterUrl ? (
            <img src={row.posterUrl} alt="" loading="lazy" />
          ) : null}
          <span>
            <Play aria-hidden />
            Play video
          </span>
        </button>
      )}
    </div>
  );
}
