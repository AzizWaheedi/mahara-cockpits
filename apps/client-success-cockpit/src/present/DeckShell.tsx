import "./present.css";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DeckHub, VideoPhase } from "./channel";
import { CHROME, CLOSED, digits, type Lang, t } from "./content";
import { DeckBoundary } from "./DeckBoundary";
import { type SlideCtx, type SlideDef, slideTitle } from "./deckContext";
import {
  keyCommand,
  type Pos,
  slideAtHash,
  stepFrom,
  withPlayer,
} from "./engine";
import { MiniRail } from "./JourneyLanes";
import type { VideoLang } from "./sources";
import { type ControlItem, VideoControl, VideoPlayer } from "./VideoPlayer";
import { filledOn, slotId, VIDEO_SLOTS } from "./videos";

/**
 * The deck engine on screen (DESIGN 5, 12.1, 15): a 1920 x 1080 canvas
 * scaled to the window, one slide mounted at a time (keyed by slide and
 * language, so its entrance replays on L), stops walked before slides, the
 * chrome hidden after 2.5 s without the mouse, `#slide-id` in the address.
 * Taken from the sales deck's DeckPage, with the client success rules:
 * Esc closes the overview and nothing more, and nothing presenter-only is
 * on the shared tab. The notes window drives it over the hub.
 */

export interface ShellProps {
  slides: SlideDef[];
  /** Everything a slide needs except where it is. */
  base: Omit<SlideCtx, "tour" | "setTour">;
  setLang: (l: Lang) => void;
  hub?: DeckHub | null;
  /** "Back to <client>" (left out in the prep preview). */
  onBack?: () => void;
  /** N and the Notes button. */
  onNotes?: () => void;
  /** A preview inside the prep view: no chrome, no keys, no address. */
  embedded?: boolean;
  /** Controlled position (the prep view's slide strip). */
  pos?: Pos;
  setPos?: (p: Pos) => void;
  /** Keys a deck adds (the launch deck's P, S, D, M, A, 1 to 3). */
  onKey?: (key: string, ctx: SlideCtx) => boolean;
  /** When the call started, for the notes window's timer. */
  startedAt?: number;
  /** The window could not close itself: show the closed screen. */
  closed?: boolean;
  /** Where the call is, after each move. */
  onPos?: (p: Pos, slideId: string) => void;
  /** Sends a slide's crash to the issue queue (the slide itself shows a calm line). */
  report?: (r: { title: string; detail: string }) => Promise<unknown>;
}

/** A slide's own render, inside its boundary (so a throw there is caught). */
function SlideBody({ slide, ctx }: { slide: SlideDef; ctx: SlideCtx }) {
  return <>{slide.render(ctx)}</>;
}

const noop = () => {};
/** A clicked chrome button lets go of the keyboard, so Space moves the deck. */
const letGo = (e: { currentTarget: HTMLElement }) => e.currentTarget.blur();

export function DeckShell({
  slides,
  base,
  setLang,
  hub,
  onBack,
  onNotes,
  embedded = false,
  pos: posIn,
  setPos: setPosIn,
  onKey,
  startedAt,
  closed = false,
  onPos,
  report,
}: ShellProps) {
  const { lang } = base;
  const [own, setOwn] = useState<Pos>(() => {
    if (embedded) return { index: 0, tour: 0 };
    const at = slideAtHash(slides, window.location.hash);
    return { index: Math.max(0, at), tour: 0 };
  });
  const pos = posIn ?? own;
  const setPos = setPosIn ?? setOwn;
  const [overview, setOverview] = useState(false);
  const [idle, setIdle] = useState(false);
  /** The video playing over the slide (never kept: a reload never reopens it). */
  const [player, setPlayer] = useState<ControlItem | null>(null);
  const [scale, setScale] = useState(1);
  const rootRef = useRef<HTMLDivElement>(null);

  const index = Math.min(pos.index, Math.max(0, slides.length - 1));
  const slide = slides[index];

  // Each slide's stops for this client, worked out from a resting context.
  const stops = useMemo(
    () =>
      slides.map(s =>
        Math.max(1, s.stops?.({ ...base, tour: 0, setTour: noop }) ?? 1),
      ),
    [slides, base],
  );
  const here = stops[index] ?? 1;
  const tour = Math.min(pos.tour, here - 1);

  // A slide hidden or shown in prep moves the list: stay on the same slide.
  const idsKey = slides.map(s => s.id).join(",");
  const lastIds = useRef(idsKey);
  const lastId = useRef(slide?.id);
  useEffect(() => {
    if (lastIds.current !== idsKey) {
      lastIds.current = idsKey;
      const at = slides.findIndex(s => s.id === lastId.current);
      if (at >= 0 && at !== pos.index) {
        setPos({ index: at, tour: pos.tour });
        return;
      }
    }
    lastId.current = slides[Math.min(pos.index, slides.length - 1)]?.id;
  }, [idsKey, slides, pos, setPos]);

  const ctxRef = useRef<SlideCtx | null>(null);
  const step = useCallback(
    (dir: 1 | -1) => {
      // The slide may take the press first (the call finishes its stage).
      const c = ctxRef.current;
      if (c && slide?.intercept?.(dir, c)) return;
      const next = stepFrom({ index, tour }, dir, stops);
      if (next) {
        setPos(next);
        setOverview(false);
      }
    },
    [index, tour, stops, setPos, slide],
  );
  const go = useCallback(
    (i: number, t0 = 0) => {
      setPos({ index: Math.max(0, Math.min(slides.length - 1, i)), tour: t0 });
      setOverview(false);
    },
    [slides.length, setPos],
  );
  const setTour = useCallback(
    (n: number) => setPos({ index, tour: Math.max(0, Math.min(here - 1, n)) }),
    [index, here, setPos],
  );

  const ctx: SlideCtx = { ...base, tour, setTour };
  ctxRef.current = ctx;

  // The slide's recorded videos (DESIGN 21.2): an empty slot has none.
  const videoItems = useMemo(
    () => (slide ? filledOn(base.d, slide.id) : []),
    [base.d, slide],
  );
  const opener = useRef<HTMLElement | null>(null);
  const openVideo = useCallback((item: ControlItem) => {
    const el = document.activeElement;
    opener.current =
      el instanceof HTMLElement && el.closest(".dkv-control") ? el : null;
    setPlayer(item);
  }, []);
  const closeVideo = useCallback(() => {
    setPlayer(null);
    // Focus goes back to the control that opened it, else to nothing.
    const back = opener.current;
    opener.current = null;
    window.setTimeout(() => {
      if (back?.isConnected) back.focus();
      else (document.activeElement as HTMLElement | null)?.blur?.();
    }, 0);
  }, []);
  /** A slot's recording by id, in a given language (the notes window's offer). */
  const itemFor = useCallback(
    (id: string, lang?: VideoLang): ControlItem | null => {
      const slot = VIDEO_SLOTS.find(s => slotId(s) === id);
      if (!slot) return null;
      if (!lang) return videoItems.find(v => v.slot === slot) ?? null;
      const row = base.d.videos.videos?.rows.find(
        r => r.deck === slot.deck && r.slotKey === slot.key && r.lang === lang,
      );
      return row ? { slot, row } : null;
    },
    [videoItems, base.d],
  );
  const playerSlot = player ? slotId(player.slot) : null;
  /** The player's last phase, for a notes window that opens while it plays. */
  const lastPhase = useRef<VideoPhase | null>(null);
  const reportPhase = useCallback(
    (phase: VideoPhase) => {
      lastPhase.current = phase;
      if (playerSlot && hub && !embedded)
        hub.post({ type: "video-state", slot: playerSlot, phase });
    },
    [hub, embedded, playerSlot],
  );
  // A player belongs to its slide: another slide closes it.
  const slideKey = slide?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes when the slide changes
  useEffect(() => {
    setPlayer(p => (p ? null : p));
  }, [slideKey]);
  // Tell the notes window when a player closes.
  const lastSlot = useRef<string | null>(null);
  useEffect(() => {
    if (lastSlot.current && lastSlot.current !== playerSlot && hub)
      hub.post({
        type: "video-state",
        slot: lastSlot.current,
        phase: "closed",
      });
    lastSlot.current = playerSlot;
  }, [playerSlot, hub]);
  const railAt = slide?.rail?.(ctx) ?? null;
  const slideId = slide?.id ?? "";
  useEffect(() => {
    if (slideId) onPos?.({ index, tour }, slideId);
  }, [onPos, index, tour, slideId]);

  // The address carries the slide, so a link or a reload lands on it.
  useEffect(() => {
    if (embedded || !slide) return;
    const { pathname, search } = window.location;
    window.history.replaceState(
      window.history.state,
      "",
      `${pathname}${search}#${slide.id}`,
    );
  }, [embedded, slide]);
  useEffect(() => {
    if (embedded) return;
    const onHash = () => {
      const at = slideAtHash(slides, window.location.hash);
      if (at >= 0 && at !== index) go(at);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [embedded, slides, index, go]);

  // Tell the notes window where the call is; answer its moves.
  const started = useRef(startedAt ?? Date.now());
  useEffect(() => {
    if (!hub || embedded || !slide) return;
    hub.post({
      type: "state",
      index,
      tour,
      slideId: slide.id,
      count: slides.length,
      stops: here,
      lang,
      startedAt: started.current,
    });
  }, [hub, embedded, slide, index, tour, slides.length, here, lang]);
  useEffect(() => {
    if (!hub || embedded) return;
    return hub.on(m => {
      if (m.type === "video") {
        if (!m.slot) closeVideo();
        else {
          const item = itemFor(m.slot, m.lang);
          if (item) openVideo(item);
        }
        return;
      }
      // With the player open, a move from the notes window closes it only.
      if ((m.type === "nav" || m.type === "goto") && player) {
        closeVideo();
        return;
      }
      if (m.type === "key" && player) return;
      if (m.type === "key" && (m.key === "v" || m.key === "V")) {
        if (videoItems[0]) openVideo(videoItems[0]);
        return;
      }
      if (m.type === "nav") {
        if (m.to === "next") step(1);
        else if (m.to === "prev") step(-1);
        else if (m.to === "first") go(0);
        else
          go(
            slides.length - 1,
            Math.max(0, (stops[slides.length - 1] ?? 1) - 1),
          );
      } else if (m.type === "goto") go(m.index, m.tour ?? 0);
      else if (m.type === "hello" && m.from === "notes" && slide) {
        hub.post({
          type: "state",
          index,
          tour,
          slideId: slide.id,
          count: slides.length,
          stops: here,
          lang,
          startedAt: started.current,
        });
        // A notes window that opens mid-video learns what is on screen.
        if (playerSlot && lastPhase.current)
          hub.post({
            type: "video-state",
            slot: playerSlot,
            phase: lastPhase.current,
          });
      } else if (m.type === "key") {
        if (!slide?.onKey?.(m.key, ctx)) onKey?.(m.key, ctx);
      }
    });
  });

  // The notes window offers the recap once the deck window is gone.
  useEffect(() => {
    if (!hub || embedded) return;
    const gone = () => hub.post({ type: "closed" });
    window.addEventListener("pagehide", gone);
    return () => window.removeEventListener("pagehide", gone);
  }, [hub, embedded]);

  // Scale: the window, or the prep view's box.
  useLayoutEffect(() => {
    const el = rootRef.current;
    const fit = () => {
      const w = embedded && el ? el.clientWidth : window.innerWidth;
      const h = embedded && el ? el.clientHeight : window.innerHeight;
      setScale(Math.min(w / 1920, h / 1080));
    };
    fit();
    if (embedded && el) {
      const ro = new ResizeObserver(fit);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [embedded]);

  // The chrome steps aside while presenting; a move of the mouse brings it back.
  useEffect(() => {
    if (embedded) return;
    let timer = window.setTimeout(() => setIdle(true), 2500);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 2500);
    };
    window.addEventListener("mousemove", wake);
    window.addEventListener("touchstart", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("touchstart", wake);
    };
  }, [embedded]);

  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  }, []);
  const toggleLang = useCallback(
    () => setLang(lang === "ar" ? "en" : "ar"),
    [lang, setLang],
  );

  useEffect(() => {
    if (embedded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "SELECT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      if (typing) {
        // Esc in a field lets go of the field; it never leaves the deck.
        if (e.key === "Escape") el.blur();
        return;
      }
      const asked = keyCommand({
        key: e.key,
        tag: el?.tagName ?? null,
        editable: Boolean(el?.isContentEditable),
        meta: e.metaKey,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        panel: Boolean(player),
        overview,
      });
      // The player is a panel: a move key, Esc or V closes it, nothing else.
      const cmd = player ? withPlayer(asked) : asked;
      if (player) {
        if (cmd === "close" || cmd === "video") {
          e.preventDefault();
          closeVideo();
        } else if (cmd === "none" && e.key === "Escape") e.preventDefault();
        else if (cmd !== "none" && cmd !== "notes" && cmd !== "fullscreen") {
          e.preventDefault();
        } else if (cmd === "notes") onNotes?.();
        else if (cmd === "fullscreen") fullscreen();
        return;
      }
      if (cmd === "video") {
        e.preventDefault();
        if (videoItems[0]) openVideo(videoItems[0]);
        return;
      }
      if (cmd === "none") {
        if (
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey &&
          (slide?.onKey?.(e.key, ctx) || onKey?.(e.key, ctx))
        )
          e.preventDefault();
        else if (e.key === "Escape") e.preventDefault();
        return;
      }
      e.preventDefault();
      if (cmd === "next") step(1);
      else if (cmd === "prev") step(-1);
      else if (cmd === "first") go(0);
      else if (cmd === "last") go(slides.length - 1);
      else if (cmd === "fullscreen") fullscreen();
      else if (cmd === "lang") toggleLang();
      else if (cmd === "overview") setOverview(v => !v);
      else if (cmd === "notes") onNotes?.();
      else if (cmd === "close") setOverview(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // A swipe on a tablet moves a stop.
  const touchX = useRef<number | null>(null);

  const dir = lang === "ar" ? "rtl" : "ltr";
  const n = slides.length;
  const count = (i: number) =>
    lang === "ar" ? digits(i, lang) : String(i).padStart(2, "0");
  const stopName = slide?.stopName?.(tour, ctx);
  const titleOf = (s: SlideDef) => slideTitle(s.title, lang, base.d.name);
  const comma = lang === "ar" ? "، " : ", ";
  const announce = slide
    ? `${t(CHROME.slide, lang)} ${digits(index + 1, lang)} ${t(CHROME.of, lang)} ${digits(n, lang)}${comma}${titleOf(slide)}${stopName ? `${comma}${t(stopName, lang)}` : ""}`
    : "";

  if (closed)
    return (
      <div className="dk-root">
        <div className="dk-closed" dir={dir} lang={lang}>
          <strong>{t(CLOSED, lang)}</strong>
        </div>
      </div>
    );

  return (
    <div
      ref={rootRef}
      className="dk-root"
      data-idle={idle && !overview ? "" : undefined}
      data-still={base.still ? "" : undefined}
      data-embedded={embedded ? "" : undefined}
      onTouchStart={e => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={e => {
        const end = e.changedTouches[0]?.clientX ?? null;
        if (touchX.current == null || end == null) return;
        const dx = end - touchX.current;
        if (Math.abs(dx) > 70) step(dx < 0 ? 1 : -1);
        touchX.current = null;
      }}
    >
      <div className="dk-stage">
        <div
          className="dk-canvas"
          dir={dir}
          lang={lang}
          style={
            {
              transform: `translate(-50%, -50%) scale(${scale})`,
            } as CSSProperties
          }
        >
          {slide ? (
            <section
              key={`${slide.id}-${lang}`}
              inert={player ? true : undefined}
              className="dk-slide"
              data-deep={slide.deep ? "" : undefined}
              data-rail={railAt != null ? "" : undefined}
              data-slide={slide.id}
              data-stop={tour}
              aria-roledescription="slide"
              aria-label={titleOf(slide)}
            >
              <DeckBoundary
                where={slide.id}
                report={report}
                fallback={
                  <div className="dk-closed" role="alert">
                    <strong>{t(CHROME.broken, lang)}</strong>
                  </div>
                }
              >
                <SlideBody slide={slide} ctx={ctx} />
              </DeckBoundary>
            </section>
          ) : null}
          {railAt != null ? (
            <MiniRail lang={lang} current={railAt} dwy={base.d.mode.dwy} />
          ) : null}
          {slide && !slide.cover ? (
            <span className="dk-count" aria-hidden>
              {`${count(index + 1)} / ${count(n)}`}
            </span>
          ) : null}
          {/* The video control is presenter chrome on the canvas's head
              band; the player covers the canvas (DESIGN 21.2, 21.3). */}
          {player ? null : (
            <VideoControl items={videoItems} lang={lang} onOpen={openVideo} />
          )}
          {player ? (
            <VideoPlayer
              key={`${slotId(player.slot)}:${player.row.lang}`}
              item={player}
              lang={lang}
              still={base.still}
              onClose={closeVideo}
              onPhase={reportPhase}
            />
          ) : null}
        </div>
      </div>

      {embedded ? null : (
        <>
          <p className="dk-sr" aria-live="polite">
            {announce}
          </p>
          <div
            className="dk-chrome"
            style={{ top: 14, insetInlineStart: 14 }}
            dir={dir}
          >
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                onPointerUp={letGo}
                dir={dir}
              >
                {/* One run: the button's flex gap plus the space read as
                    two spaces before the name (score round 2). */}
                <span>
                  {t(CHROME.back, lang)} <bdi>{base.d.name}</bdi>
                </span>
              </button>
            ) : null}
          </div>
          <div
            className="dk-chrome"
            style={{ top: 14, insetInlineEnd: 14 }}
            dir={dir}
          >
            <button
              type="button"
              aria-pressed={lang === "ar"}
              onClick={() => lang !== "ar" && setLang("ar")}
              onPointerUp={letGo}
            >
              ع
            </button>
            <button
              type="button"
              aria-pressed={lang === "en"}
              onClick={() => lang !== "en" && setLang("en")}
              onPointerUp={letGo}
            >
              EN
            </button>
            {onNotes ? (
              <button
                type="button"
                onClick={onNotes}
                onPointerUp={letGo}
                title="N"
              >
                {t(CHROME.notes, lang)}
              </button>
            ) : null}
            <button
              type="button"
              aria-pressed={overview}
              onClick={() => setOverview(v => !v)}
              onPointerUp={letGo}
              title="O"
            >
              {t(CHROME.all, lang)}
            </button>
            <button
              type="button"
              onClick={fullscreen}
              onPointerUp={letGo}
              title="F"
            >
              {t(CHROME.full, lang)}
            </button>
          </div>
          <div className="dk-chrome dk-nav" dir="ltr">
            <button
              type="button"
              onClick={() => step(lang === "ar" ? 1 : -1)}
              onPointerUp={letGo}
              disabled={
                lang === "ar"
                  ? !stepFrom({ index, tour }, 1, stops)
                  : !stepFrom({ index, tour }, -1, stops)
              }
              aria-label={t(lang === "ar" ? CHROME.next : CHROME.prev, lang)}
            >
              ←
            </button>
            <span className="dk-nav-n">
              {digits(index + 1, lang)} / {digits(n, lang)}
            </span>
            <button
              type="button"
              onClick={() => step(lang === "ar" ? -1 : 1)}
              onPointerUp={letGo}
              disabled={
                lang === "ar"
                  ? !stepFrom({ index, tour }, -1, stops)
                  : !stepFrom({ index, tour }, 1, stops)
              }
              aria-label={t(lang === "ar" ? CHROME.prev : CHROME.next, lang)}
            >
              →
            </button>
          </div>
          {overview ? (
            <div
              className="dk-overview"
              role="dialog"
              aria-label={t(CHROME.all, lang)}
            >
              <div className="dk-overview-in" dir={dir} lang={lang}>
                <div className="dk-overview-head">
                  <h2>{t(CHROME.all, lang)}</h2>
                  <p>{t(CHROME.keys, lang)}</p>
                </div>
                <div className="dk-overview-grid">
                  {slides.map((s, i) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-current={i === index}
                      onClick={() => go(i)}
                      onPointerUp={letGo}
                    >
                      <span className="dk-overview-n">
                        {digits(i + 1, lang)}
                      </span>
                      <span>{titleOf(s)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
