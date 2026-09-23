import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import logo from "../assets/mahara-logo.png";
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
 *
 * It wears the brand exactly (Mahara Media Brand Guidelines v1.0): the
 * real wordmark, teal and white on Deep Space, Geist, and the Mahara
 * Gradient kept for one thing, the ring around the client's cut.
 */

type Note = { at_seconds: number | null; body: string; at: string };
type Item = {
  id: string;
  n: number;
  kind: "video" | "image";
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

/** 1 -> "01": cuts are numbered like a slate, in the order they were sent. */
function two(n: number): string {
  return String(n).padStart(2, "0");
}

function Check() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2.5 6.2 5 8.5l4.5-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Status({ decision }: { decision: Item["decision"] }) {
  if (decision === "approved")
    return (
      <span className="pill ok mono">
        <Check />
        Approved
      </span>
    );
  if (decision === "changes")
    return <span className="pill change mono">Change asked</span>;
  return (
    <span className="pill wait mono">
      <i aria-hidden="true" />
      Waiting for you
    </span>
  );
}

/** A frame for the reel: the poster, the still itself, or the film's own
 *  first moment -- never an empty box where a cut should be. */
function Thumb({ x }: { x: Item }) {
  if (x.poster_url) return <img src={x.poster_url} alt="" loading="lazy" />;
  if (x.kind === "image")
    return <img src={x.video_url} alt="" loading="lazy" />;
  return (
    <video src={`${x.video_url}#t=0.5`} muted playsInline preload="metadata" />
  );
}

function Foot() {
  return (
    <footer className="foot mono">
      <span>Mahara Media</span>
      <a href="https://maharamedia.com" target="_blank" rel="noreferrer">
        maharamedia.com
      </a>
    </footer>
  );
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

  useEffect(() => {
    const was = document.title;
    const bar = document.querySelector('meta[name="theme-color"]');
    const barWas = bar?.getAttribute("content") ?? null;
    document.title =
      bundle && bundle !== "missing"
        ? `${bundle.title} · Mahara Media`
        : "Mahara Media";
    bar?.setAttribute("content", "#091333");
    return () => {
      document.title = was;
      if (barWas) bar?.setAttribute("content", barWas);
    };
  }, [bundle]);

  if (bundle === null)
    return (
      <main className="screen center" aria-busy="true">
        <img src={logo} alt="Mahara Media" className="loadingMark" />
      </main>
    );

  if (bundle === "missing")
    return (
      <main className="screen">
        <div className="sheet" style={{ margin: "auto" }}>
          <img src={logo} alt="Mahara Media" className="logo" />
          <h1 className="display">This link has expired</h1>
          <p className="lede">
            Ask whoever sent it for a new one and it will open straight away.
          </p>
        </div>
        <Foot />
      </main>
    );

  const items = bundle.items;
  const here = Math.min(openIndex, items.length - 1);
  const item = items[here];
  const decided = items.filter(i => i.decision).length;
  const allDone = decided === items.length && items.length > 0;
  const approvedCount = items.filter(i => i.decision === "approved").length;
  const changeCount = items.filter(i => i.decision === "changes").length;
  const watching = Boolean(item) && (!allDone || reopened);
  const noun = items.every(i => i.kind === "image")
    ? " images"
    : items.every(i => i.kind === "video")
      ? " cuts"
      : "";

  async function decide(decision: "approved" | "changes" | null) {
    if (!item) return;
    setBusy(true);
    try {
      const { data } = await supabase.rpc("review_decide", {
        p_token: token,
        p_item: item.id,
        p_decision: decision,
        p_note: decision === "approved" ? "" : note,
        // A still has no timecode, and 0:00 on an image is a lie the
        // editor would have to decode.
        p_at:
          decision === "approved" || item.kind === "image"
            ? null
            : Math.floor(at),
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
        <img
          src={logo}
          alt="Mahara Media"
          className="logo"
          width={105}
          height={28}
        />
        {bundle.client ? (
          <span className="for mono">
            <span className="lbl">Prepared for</span>
            <bdi>{bundle.client}</bdi>
          </span>
        ) : null}
      </header>
      {items.length > 1 ? (
        <div
          className="progress"
          role="img"
          aria-label={`${decided} of ${items.length} decided`}
        >
          {items.map((x, i) => (
            <span
              key={x.id}
              className={`seg ${x.decision ?? ""} ${
                watching && i === here ? "here" : ""
              }`}
            />
          ))}
        </div>
      ) : null}

      {allDone && !reopened ? (
        <section className="sheet done">
          <p className="cut mono">Thank you</p>
          <h1 className="display">
            {changeCount === 0
              ? "Everything is approved."
              : "Your notes are with the editor."}
          </h1>
          <p className="lede">
            {changeCount === 0
              ? "We will take it from here."
              : "You will have the next cut shortly."}
          </p>
          <div className="stats">
            <div className="stat">
              <b>{approvedCount}</b>
              <span className="mono">Approved</span>
            </div>
            {changeCount ? (
              <div className="stat">
                <b>{changeCount}</b>
                <span className="mono">
                  {changeCount === 1 ? "Change asked" : "Changes asked"}
                </span>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {watching && item ? (
        <>
          <section className="stage">
            <div className="ring">
              {item.kind === "image" ? (
                <img src={item.video_url} alt={item.title} className="film" />
              ) : (
                /* biome-ignore lint/a11y/useMediaCaption: the client's own footage, no track exists */
                <video
                  key={item.id}
                  ref={video}
                  /* Without a poster a browser shows a black rectangle until
                 somebody presses play. Asking for a fraction of a second
                 in makes it decode and show the first frame instead,
                 which is the difference between a delivery and a broken
                 embed. */
                  src={
                    item.poster_url ? item.video_url : `${item.video_url}#t=0.1`
                  }
                  poster={item.poster_url ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  onTimeUpdate={e =>
                    setAt((e.target as HTMLVideoElement).currentTime)
                  }
                  className="film"
                />
              )}
            </div>
          </section>

          <section className="below">
            <div className="eyebrow">
              <span className="cut mono">
                {items.length > 1
                  ? `${item.kind === "image" ? "Image" : "Cut"} ${two(here + 1)} / ${two(items.length)}`
                  : item.kind === "image"
                    ? "Image"
                    : "Video"}
              </span>
              {item.kind === "video" && item.seconds ? (
                <span className="dur mono">{clock(item.seconds)}</span>
              ) : null}
              <Status decision={item.decision} />
            </div>
            <h1 className="title" dir="auto">
              {item.title}
            </h1>
            <p className="lede" dir="auto">
              {bundle.note ?? bundle.title}
            </p>

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
                      <span key={`${n.at}`} className="note" dir="auto">
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
                  What should change?
                  {item.kind === "image" ? null : (
                    <span className="mono">At {clock(at) || "0:00"}</span>
                  )}
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
                  Approve this {item.kind === "image" ? "image" : "video"}
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
        </>
      ) : null}

      {items.length > 1 || (allDone && !reopened && items.length) ? (
        <nav
          className="reel"
          aria-label={
            watching ? "Every cut in this delivery" : "Watch one again"
          }
        >
          <p className="reelLabel mono">
            {watching ? `All ${items.length}${noun}` : "Watch one again"}
          </p>
          <div className="frames">
            {items.map((x, i) => (
              <button
                key={x.id}
                type="button"
                aria-current={watching && i === here}
                aria-label={`${two(i + 1)} ${x.title}${
                  x.decision === "approved"
                    ? ", approved"
                    : x.decision === "changes"
                      ? ", change asked"
                      : ""
                }`}
                onClick={() => {
                  setOpenIndex(i);
                  setAsking(false);
                  setReopened(true);
                }}
                className={`frame ${x.decision ?? ""} ${
                  watching && i === here ? "on" : ""
                }`}
              >
                <span className="thumb">
                  <Thumb x={x} />
                  <span className="num mono">{two(i + 1)}</span>
                  {x.decision ? (
                    <span className={`mini ${x.decision}`} aria-hidden="true">
                      {x.decision === "approved" ? <Check /> : "!"}
                    </span>
                  ) : null}
                </span>
                <span className="frameTitle" dir="auto">
                  {x.title}
                </span>
              </button>
            ))}
          </div>
        </nav>
      ) : null}
      <Foot />
    </main>
  );
}
