import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang, sep, t, tf, VIDEO } from "./content";
import type { VideoRow } from "./sources";
import {
  frameSrc,
  handshake,
  LOAD_TIMEOUT_MS,
  LOADING_LINE_MS,
  lengthText,
  ownMessage,
  type PlayerPhase,
  PROVIDER_ORIGIN,
  playerStep,
  readPlayerMessage,
  rowTitle,
  type VideoSlot,
} from "./videos";

/**
 * The decks' video pieces (DESIGN 21.2, 21.3, 21.5): the quiet "Watch:"
 * control in the canvas's head band (presenter chrome: shown only while the
 * chrome is awake or it has the keyboard), the player over the canvas, and
 * prep's small "Check it plays" frame. Each player keeps its own frame and
 * reads only its own messages; the deck posts to a provider only at its
 * exact origin, never "*".
 */

/** The frame's sandbox: no popups, no top navigation, no forms. */
export const FRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-presentation";
/** No camera, microphone, location or clipboard. */
export const FRAME_ALLOW =
  "autoplay; fullscreen; picture-in-picture; encrypted-media";

/**
 * One player's frame: its address, its phase, its handshake and its
 * messages. `src` null means there is nothing safe to frame (failed).
 */
export function usePlayerFrame(
  row: Pick<VideoRow, "provider" | "embedUrl">,
  autoplay: boolean,
  onPhase?: (p: PlayerPhase) => void,
) {
  const src = frameSrc(row, {
    autoplay,
    origin: typeof window === "undefined" ? undefined : window.location.origin,
  });
  const frame = useRef<HTMLIFrameElement>(null);
  const [phase, setPhase] = useState<PlayerPhase>(src ? "loading" : "failed");
  const [slow, setSlow] = useState(false);
  const step = useCallback(
    (ev: Parameters<typeof playerStep>[1]) => setPhase(p => playerStep(p, ev)),
    [],
  );
  const reported = useRef<PlayerPhase | null>(null);
  useEffect(() => {
    if (reported.current === phase) return;
    reported.current = phase;
    onPhase?.(phase);
  }, [phase, onPhase]);
  useEffect(() => {
    if (!src) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      step({ type: "offline" });
    const late = window.setTimeout(() => setSlow(true), LOADING_LINE_MS);
    const lapse = window.setTimeout(
      () => step({ type: "timeout" }),
      LOAD_TIMEOUT_MS,
    );
    const offline = () => step({ type: "offline" });
    const onMessage = (e: MessageEvent) => {
      if (!ownMessage(e, row.provider, frame.current?.contentWindow)) return;
      const signal = readPlayerMessage(row.provider, e.data);
      if (signal) step({ type: "signal", signal });
    };
    window.addEventListener("offline", offline);
    window.addEventListener("message", onMessage);
    return () => {
      window.clearTimeout(late);
      window.clearTimeout(lapse);
      window.removeEventListener("offline", offline);
      window.removeEventListener("message", onMessage);
    };
  }, [src, row.provider, step]);
  const onLoad = useCallback(() => {
    step({ type: "load" });
    const w = frame.current?.contentWindow;
    if (!w) return;
    for (const m of handshake(row.provider))
      w.postMessage(m, PROVIDER_ORIGIN[row.provider]);
  }, [row.provider, step]);
  return { src, frame, phase, slow, onLoad };
}

/** The 16 px play triangle, in the text's own colour. */
function Triangle() {
  return (
    <svg
      className="dkv-tri"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden
    >
      <path d="M3 1.5v13l11-6.5z" fill="currentColor" />
    </svg>
  );
}

export interface ControlItem {
  slot: VideoSlot;
  row: VideoRow;
}

/** A clicked control lets go of the keyboard, so Space moves the deck. */
const letGo = (e: { currentTarget: HTMLElement }) => e.currentTarget.blur();

/**
 * The quiet control (DESIGN 21.2): one line of text in the canvas's head
 * band, centred. "Watch:" is said once, unlined, before one or two videos:
 * one grammar for both. It is never drawn for an empty slot.
 */
export function VideoControl({
  items,
  lang,
  onOpen,
}: {
  items: ControlItem[];
  lang: Lang;
  onOpen: (item: ControlItem) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="dkv-control" data-video-control="">
      <span className="dkv-watch" aria-hidden>
        {t(VIDEO.watch, lang)}
      </span>
      {items.map(it => {
        const title = rowTitle(it.slot, it.row, lang);
        const length = lengthText(it.row.durationSeconds, lang);
        return (
          <button
            key={`${it.slot.key}:${it.row.lang}`}
            type="button"
            className="dkv-item"
            aria-label={tf(length ? VIDEO.label : VIDEO.labelBare, lang, {
              title,
              length: length ?? "",
            })}
            onClick={() => onOpen(it)}
            onPointerUp={letGo}
          >
            <Triangle />
            <span className="dkv-text">
              <bdi>{title}</bdi>
              {length ? (
                <>
                  <span className="dkv-dot">{sep(lang)}</span>
                  <span className="dkv-len">{length}</span>
                </>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The player over the canvas (DESIGN 21.3): a veil, the title and Close,
 * and the provider's own player in a 1440 x 810 frame. Focus goes to the
 * dialog itself, so Esc and the deck's keys still reach the deck.
 */
export function VideoPlayer({
  item,
  lang,
  still,
  onClose,
  onPhase,
}: {
  item: ControlItem;
  lang: Lang;
  still: boolean;
  onClose: () => void;
  onPhase: (p: PlayerPhase) => void;
}) {
  const { row, slot } = item;
  const [attempt, setAttempt] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.focus();
  }, []);
  const title = rowTitle(slot, row, lang);
  const length = lengthText(row.durationSeconds, lang);
  /** The keys go back to the dialog, so Esc and the deck keys stay with the
   *  player: a blur would leave them on the page, where Quick pitch's Esc
   *  closes the whole pitch and Space moves the slide too. */
  const home = useCallback(() => dialog.current?.focus(), []);
  const retry = useCallback(() => {
    setAttempt(n => n + 1);
    home();
  }, [home]);
  return (
    <div className="dkv-veil" data-still={still ? "" : undefined}>
      {/* A click on the veil around the frame closes it; Esc and V close
          it from the keyboard (the deck's own keys, read by the shell). */}
      <div
        ref={dialog}
        className="dkv-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dkv-title"
        tabIndex={-1}
        onKeyDown={e => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        onClick={e => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="dkv-head">
          <span id="dkv-title" className="dkv-title">
            <bdi>{title}</bdi>
          </span>
          {length ? (
            <span className="dkv-len dkv-head-len">{length}</span>
          ) : null}
          <button
            type="button"
            className="dkv-close"
            onClick={onClose}
            onPointerUp={letGo}
          >
            {t(VIDEO.close, lang)}
          </button>
        </div>
        <PlayerFrame
          key={attempt}
          row={row}
          title={title}
          lang={lang}
          onPhase={onPhase}
          onRetry={retry}
          onAway={home}
        />
      </div>
    </div>
  );
}

/**
 * The player's frame and its lines (DESIGN 21.3). "Try again" mounts it
 * afresh under a new key: a new frame, a new handshake and a new 15 s.
 * Quick pitch has no notes window, so the way back is on the canvas.
 */
function PlayerFrame({
  row,
  title,
  lang,
  onPhase,
  onRetry,
  onAway,
}: {
  row: VideoRow;
  title: string;
  lang: Lang;
  onPhase: (p: PlayerPhase) => void;
  onRetry: () => void;
  /** After the link opens its tab: the keys go back to the dialog. */
  onAway: () => void;
}) {
  const { src, frame, phase, slow, onLoad } = usePlayerFrame(
    row,
    true,
    onPhase,
  );
  const gone = phase === "failed" || phase === "blocked";
  return (
    <div className="dkv-frame" data-phase={phase}>
      {src && !gone ? (
        <iframe
          ref={frame}
          src={src}
          title={title}
          sandbox={FRAME_SANDBOX}
          allow={FRAME_ALLOW}
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={onLoad}
        />
      ) : null}
      {phase === "loading" && slow ? (
        <p className="dkv-line" data-quiet="">
          {t(VIDEO.loading, lang)}
        </p>
      ) : null}
      {phase === "failed" ? (
        <div className="dkv-gone">
          <p className="dkv-line">{t(VIDEO.failed, lang)}</p>
          {/* Not letGo: a blur leaves the keys on the page, not the player. */}
          <div className="dkv-acts">
            {src ? (
              <button type="button" className="dkv-act" onClick={onRetry}>
                {t(VIDEO.retry, lang)}
              </button>
            ) : null}
            <a
              className="dkv-act"
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              // Pointer up for every button (a middle-click or the menu's
              // "Open in new tab" fires no click); click for Enter.
              onPointerUp={onAway}
              onClick={onAway}
            >
              {t(VIDEO.open, lang)}
            </a>
          </div>
        </div>
      ) : null}
      {phase === "blocked" ? (
        <p className="dkv-line">{t(VIDEO.blocked, lang)}</p>
      ) : null}
    </div>
  );
}

/**
 * Prep's "Check it plays" (DESIGN 21.5): the same frame inline, small, with
 * no autoplay, reading only its own messages. It is the guard for Loom and
 * Drive, which cannot report a sign-in or no-access page.
 */
export function CheckPlayer({ row, title }: { row: VideoRow; title: string }) {
  const { src, frame, phase, onLoad } = usePlayerFrame(row, false);
  return (
    <div className="space-y-1.5">
      <div className="relative h-[198px] w-[352px] max-w-full overflow-hidden rounded-lg border bg-muted/30">
        {src && phase !== "failed" ? (
          <iframe
            ref={frame}
            src={src}
            title={title}
            sandbox={FRAME_SANDBOX}
            allow={FRAME_ALLOW}
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={onLoad}
            className="size-full"
          />
        ) : null}
      </div>
      <div className="text-xs text-muted-foreground">
        {phase === "failed"
          ? "It didn't load. Check the connection, or the link."
          : phase === "blocked"
            ? "The provider says it can't play here (its privacy or sharing setting). Fix the sharing, then check again."
            : "If it asks for a sign-in, says you need access or says the content is blocked, change its sharing: 'Anyone with the link' on Loom and Drive, embedding allowed for cockpit.maharamedia.com on Vimeo."}
      </div>
    </div>
  );
}
