import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { supabase } from "../lib/supabase";
import "../review.css";

/**
 * The client's review page.
 *
 * Public: whoever holds the link watches the finished videos and either
 * approves each one or says what to change. It reads and writes through
 * two security-definer functions rather than the tables, so a guessed
 * token returns nothing and there is nothing to enumerate.
 *
 * Built as a screening rather than a tool. This is the most visible
 * thing the agency hands over, and a page that looks like software says
 * "you are using our system" where this should say "this was made for
 * you". So the video is the whole surface, the decision sits directly
 * under it, and everything else gets out of the way.
 */

type Note = { at_seconds: number | null; body: string; at: string };
type Item = {
  id: string;
  n: number;
  title: string;
  video_url: string;
  poster_url: string | null;
  seconds: number | null;
  decision: "approved" | "changes" | null;
  decided_at: string | null;
  notes: Note[];
};
type Bundle = {
  title: string;
  note: string | null;
  client: string | null;
  reviewer: string | null;
  items: Item[];
};

function clock(s: number | null): string {
  if (s == null || !Number.isFinite(s)) return "";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export default function ReviewPage() {
  const { token = "" } = useParams();
  const [bundle, setBundle] = useState<Bundle | null | "missing">(null);
  const [at, setAt] = useState(0);
  const [openIndex, setOpenIndex] = useState(0);
  const [asking, setAsking] = useState(false);
  /**
   * Once every video has a decision the page resolves to the thank-you
   * rather than leaving a stage and two buttons under it. Pressing a
   * frame in the reel reopens that one to watch again.
   */
  const [reopened, setReopened] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  const draftKey = `review:${token}:note`;

  useEffect(() => {
    try {
      const kept = window.localStorage.getItem(draftKey);
      if (kept) {
        setNote(kept);
        setAsking(true);
      }
    } catch {
      // Private browsing refuses storage. The page works without it.
    }
  }, [draftKey]);

  useEffect(() => {
    try {
      if (note.trim()) window.localStorage.setItem(draftKey, note);
      else window.localStorage.removeItem(draftKey);
    } catch {
      // As above: a lost draft is a nuisance, a crash is not acceptable.
    }
  }, [note, draftKey]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("review_open", {
      p_token: token,
    });
    setBundle(error || !data ? "missing" : (data as Bundle));
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (bundle === null) return <main className="screen" aria-busy="true" />;

  if (bundle === "missing")
    return (
      <main className="screen center">
        <div className="sheet">
          <h1 className="display">This link has expired</h1>
          <p className="lede">
            Ask whoever sent it for a new one and it will open straight away.
          </p>
        </div>
      </main>
    );

  const items = bundle.items;
  const item = items[Math.min(openIndex, items.length - 1)];
  const decided = items.filter(i => i.decision).length;
  const allDone = decided === items.length && items.length > 0;

  async function decide(decision: "approved" | "changes" | null) {
    if (!item) return;
    setBusy(true);
    try {
      const { data } = await supabase.rpc("review_decide", {
        p_token: token,
        p_item: item.id,
        p_decision: decision,
        p_note: decision === "approved" ? "" : note,
        p_at: decision === "approved" ? null : Math.floor(at),
        p_name: name.trim() || null,
      });
      if (!(data as { ok?: boolean } | null)?.ok) {
        window.alert("That did not save. Refresh the page and try once more.");
        return;
      }
      setNote("");
      setAsking(false);
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        // nothing to clear
      }
      await load();
      // Move to the next undecided one; a client should never have to
      // hunt for what is left.
      const next = items.findIndex((x, i) => i > openIndex && !x.decision);
      if (next !== -1) setOpenIndex(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <header className="bar">
        <span className="mark">Mahara</span>
        {items.length > 1 ? (
          <span className="count">
            {decided} of {items.length} decided
          </span>
        ) : null}
      </header>

      {allDone && !reopened ? (
        <section className="sheet done">
          <h1 className="display">Thank you</h1>
          <p className="lede">
            {items.every(i => i.decision === "approved")
              ? "Everything is approved. We will take it from here."
              : "Your notes are with the editor. You will have the next cut shortly."}
          </p>
        </section>
      ) : null}

      {item && (!allDone || reopened) ? (
        <>
          <section className="stage">
            {/* biome-ignore lint/a11y/useMediaCaption: the client's own footage, no track exists */}
            <video
              key={item.id}
              ref={video}
              /* Without a poster a browser shows a black rectangle until
                 somebody presses play. Asking for a fraction of a second
                 in makes it decode and show the first frame instead,
                 which is the difference between a delivery and a broken
                 embed. */
              src={item.poster_url ? item.video_url : `${item.video_url}#t=0.1`}
              poster={item.poster_url ?? undefined}
              controls
              playsInline
              preload="metadata"
              onTimeUpdate={e =>
                setAt((e.target as HTMLVideoElement).currentTime)
              }
              className="film"
            />
          </section>

          <section className="below">
            <div className="titling">
              <h1 className="title">{item.title}</h1>
              <p className="lede">{bundle.note ?? bundle.title}</p>
            </div>

            {item.decision && !asking ? (
              <div className={`verdict ${item.decision}`}>
                <p className="verdictLine">
                  {item.decision === "approved"
                    ? "You approved this one."
                    : "You asked for a change."}
                </p>
                {item.notes.length ? (
                  <span className="notes">
                    {item.notes.map(n => (
                      <span key={`${n.at}`} className="note">
                        {n.at_seconds != null ? (
                          <button
                            type="button"
                            className="stamp"
                            onClick={() => {
                              if (video.current)
                                video.current.currentTime = n.at_seconds ?? 0;
                            }}
                          >
                            {clock(n.at_seconds)}
                          </button>
                        ) : null}
                        {n.body}
                      </span>
                    ))}
                  </span>
                ) : null}
                <span className="row">
                  <button
                    type="button"
                    className="btn link"
                    onClick={() => {
                      video.current?.pause();
                      setAsking(true);
                    }}
                  >
                    Add another note
                  </button>
                  {item.decision === "changes" ? (
                    <button
                      type="button"
                      className="btn link"
                      disabled={busy}
                      onClick={() => void decide("approved")}
                    >
                      Actually, approve it
                    </button>
                  ) : null}
                </span>
              </div>
            ) : asking ? (
              <div className="ask">
                <label htmlFor="note" className="askLabel">
                  What should change? We are at {clock(at)}.
                </label>
                <textarea
                  id="note"
                  rows={3}
                  dir="auto"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="The logo at the end is the old one"
                />
                {bundle.reviewer ? null : (
                  <input
                    className="who"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Your name, so the editor knows who asked"
                  />
                )}
                <div className="row">
                  <button
                    type="button"
                    className="btn solid"
                    disabled={busy || !note.trim()}
                    onClick={() =>
                      void decide(item.decision ? null : "changes")
                    }
                  >
                    {item.decision ? "Add this note" : "Send this note"}
                  </button>
                  <button
                    type="button"
                    className="btn quiet"
                    onClick={() => setAsking(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="row">
                <button
                  type="button"
                  className="btn solid"
                  disabled={busy}
                  onClick={() => void decide("approved")}
                >
                  Approve this video
                </button>
                <button
                  type="button"
                  className="btn quiet"
                  disabled={busy}
                  onClick={() => {
                    video.current?.pause();
                    setAsking(true);
                  }}
                >
                  Ask for a change
                </button>
              </div>
            )}
          </section>

          {items.length > 1 ? (
            <nav className="reel" aria-label="The rest of the videos">
              {items.map((x, i) => (
                <button
                  key={x.id}
                  type="button"
                  aria-current={i === openIndex}
                  onClick={() => {
                    setOpenIndex(i);
                    setAsking(false);
                    setReopened(true);
                  }}
                  className={`frame ${x.decision ?? ""} ${i === openIndex ? "on" : ""}`}
                >
                  {x.poster_url ? (
                    <img src={x.poster_url} alt="" loading="lazy" />
                  ) : (
                    <span className="blank" />
                  )}
                  <span className="frameTitle">{x.title}</span>
                </button>
              ))}
            </nav>
          ) : null}
        </>
      ) : null}

      {allDone && !reopened && items.length ? (
        <nav className="reel" aria-label="Watch one again">
          {items.map((x, i) => (
            <button
              key={x.id}
              type="button"
              onClick={() => {
                setOpenIndex(i);
                setReopened(true);
              }}
              className={`frame ${x.decision ?? ""}`}
            >
              {x.poster_url ? (
                <img src={x.poster_url} alt="" loading="lazy" />
              ) : (
                <span className="blank" />
              )}
              <span className="frameTitle">{x.title}</span>
            </button>
          ))}
        </nav>
      ) : null}
    </main>
  );
}
