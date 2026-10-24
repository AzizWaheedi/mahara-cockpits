import { type RefObject, useEffect, useRef, useState } from "react";
import { acceptFrame, type FrameMessage } from "@/lib/deckHost";
import { cn } from "@/lib/utils";

/**
 * One frame of the client success app's Brand Blueprint deck, on this
 * origin (docs/brand-blueprint/EMBED.md 4.5): the frame, the message bridge
 * (this origin, this frame's own window, our envelope), the 15 s wait for
 * `ready`, the watch on the frame's own address, the wait while offline,
 * `inert` when told, and the fade-in.
 *
 * No sandbox: the deck needs its storage (the shared sign-in), its scripts
 * and its popups (the notes window, Google's documents), all on our origin.
 */

/** What the frame itself cannot say. */
export type FrameTrouble =
  /** No `ready` within the wait. */
  | "slow"
  /** The frame is on a path that is not its Blueprint path. */
  | "left"
  /** The browser is offline: the frame waits to load. */
  | "offline"
  /** The connection is back: the frame loads now. */
  | "online";

export const READY_WAIT_MS = 15_000;

export function DeckFrame({
  src,
  title,
  allowed,
  onMessage,
  onTrouble,
  shown,
  inert = false,
  frameRef,
  wait = READY_WAIT_MS,
  className,
}: {
  src: string;
  title: string;
  /** The frame's own path is one it may be on. */
  allowed: (pathname: string) => boolean;
  onMessage: (m: FrameMessage) => void;
  onTrouble: (t: FrameTrouble) => void;
  /** Fade in: the frame said `ready`. */
  shown: boolean;
  inert?: boolean;
  frameRef?: RefObject<HTMLIFrameElement | null>;
  wait?: number;
  className?: string;
}) {
  const own = useRef<HTMLIFrameElement>(null);
  const ref = frameRef ?? own;
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine !== false,
  );
  const said = useRef(onMessage);
  said.current = onMessage;
  const trouble = useRef(onTrouble);
  trouble.current = onTrouble;
  const allow = useRef(allowed);
  allow.current = allowed;

  // The bridge: only this frame's own window, on this origin, in our envelope.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = acceptFrame(
        e,
        window.location.origin,
        ref.current?.contentWindow ?? null,
      );
      if (m) said.current(m);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [ref]);

  // Offline: load when the connection is back.
  useEffect(() => {
    if (online) return;
    trouble.current("offline");
    const back = () => {
      setOnline(true);
      trouble.current("online");
    };
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [online]);

  // The wait for `ready`, from the moment the frame starts to load.
  useEffect(() => {
    if (!online || shown) return;
    const t = window.setTimeout(() => trouble.current("slow"), wait);
    return () => window.clearTimeout(t);
  }, [online, shown, wait]);

  // The frame's own address, on each load and every second after (the deck
  // is a single-page app, so a redirect inside it fires no load): anywhere
  // but its Blueprint path, and the page hides it.
  useEffect(() => {
    if (!online) return;
    let gone = false;
    const look = () => {
      const w = ref.current?.contentWindow;
      if (!w || gone) return;
      let path: string | null = null;
      try {
        // The first moment of a frame is about:blank; that is not leaving.
        if (w.location.href === "about:blank") return;
        path = w.location.pathname;
      } catch {
        // another origin's page: never ours to show
        path = null;
      }
      if (path === null || !allow.current(path)) {
        gone = true;
        trouble.current("left");
      }
    };
    const el = ref.current;
    el?.addEventListener("load", look);
    const t = window.setInterval(look, 1000);
    return () => {
      el?.removeEventListener("load", look);
      window.clearInterval(t);
    };
  }, [online, ref]);

  if (!online) return null;
  return (
    <iframe
      ref={ref}
      src={src}
      title={title}
      allow="fullscreen"
      allowFullScreen
      inert={inert}
      aria-hidden={shown ? undefined : true}
      className={cn(
        "block h-full w-full border-0 bg-transparent transition-opacity duration-[140ms] ease-out motion-reduce:transition-none",
        shown ? "opacity-100" : "opacity-0",
        className,
      )}
    />
  );
}
