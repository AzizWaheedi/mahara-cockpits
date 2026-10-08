import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { type L, type Lang, t } from "./content";
import type { Pic } from "./proof";

/**
 * What sits over the deck's media (Aziz, 2026-10-08: "for the brand dna
 * have a link to the doc if we hover over it ... same thing for landing page
 * if we hover or click it it should make it popup"): the chip that says what
 * a click opens, and the pop-up that shows a live page inside the deck.
 */

const ar = (lang: Lang) => lang === "ar";

/** The chip over linked media, shown on hover and focus: what a click opens. */
export function OpenChip({
  children,
  center,
  expand,
}: {
  children: ReactNode;
  /** In the middle of the media, not at its foot. */
  center?: boolean;
  /** It opens over the deck (a pop-up), not in a new tab. */
  expand?: boolean;
}) {
  return (
    <span
      className="dk-open-chip"
      data-center={center ? "" : undefined}
      aria-hidden
    >
      {expand ? (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
          <path
            d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      <span>{children}</span>
      {expand ? null : <span className="dk-ltr">↗</span>}
    </span>
  );
}

export const OPEN_DOC: L = { en: "Open the document", ar: "افتح الملف" };
export const TRY_LIVE: L = { en: "Try the live page", ar: "جرّب الصفحة بنفسك" };

const COPY = {
  title: {
    en: "The landing page, as a lead sees it",
    ar: "اللاندنق بيج.. مثل ما يشوفها العميل",
  },
  views: { en: "View", ar: "العرض" },
  desktop: { en: "Desktop", ar: "كمبيوتر" },
  phone: { en: "Phone", ar: "تلفون" },
  newTab: { en: "Open in a new tab", ar: "افتحها بتاب يديد" },
  close: { en: "Close", ar: "إغلاق" },
  loading: { en: "Loading the live page", ar: "الصفحة قاعدة تحمّل" },
  live: { en: "The real page, live", ar: "الصفحة الحقيقية.. لايف" },
  failed: {
    en: "The live page didn't load in time. This is a screenshot of it.",
    ar: "الصفحة ما فتحت بوقتها.. هذي صورة منها.",
  },
  retry: { en: "Try again", ar: "جرّب مرة ثانية" },
} satisfies Record<string, L>;

/** How long the live page has to load before the screenshot stays instead. */
const LOAD_MS = 5000;
/** The closing animation, kept in step with deck.css. */
const LEAVE_MS = 220;

type View = "desktop" | "phone";
type Status = "loading" | "live" | "failed";

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The deck's own fit: the 1920 × 1080 canvas, as large as the window allows. */
const fitCanvas = () =>
  Math.min(window.innerWidth / 1920, window.innerHeight / 1080);

function useCanvasScale() {
  const [scale, setScale] = useState(fitCanvas);
  useLayoutEffect(() => {
    const on = () => setScale(fitCanvas());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return scale;
}

const FOCUSABLE =
  'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * A live page in a pop-up over the deck: in a browser or on a phone, the
 * screenshot standing in until it loads and staying if it does not within
 * 5 s. Esc or Close shuts it; focus stays inside it, and the deck's keys
 * (→ ← F L O Q) wait until it is shut.
 */
export function LivePage({
  url,
  lang,
  desktop,
  phone,
  onClose,
}: {
  url: string;
  lang: Lang;
  desktop: Pic;
  phone: Pic;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>("desktop");
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const scale = useCanvasScale();
  const host = new URL(url).host;

  const close = useCallback(() => {
    if (reducedMotion()) {
      onClose();
      return;
    }
    setLeaving(true);
    window.setTimeout(onClose, LEAVE_MS);
  }, [onClose]);
  const closeRef = useRef(close);
  closeRef.current = close;

  // Five seconds to load; after that the screenshot stays and says so. A
  // page that arrives later still takes its place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new attempt restarts the clock
  useEffect(() => {
    if (navigator.onLine === false) {
      setStatus("failed");
      return;
    }
    setStatus("loading");
    const timer = window.setTimeout(
      () => setStatus(s => (s === "loading" ? "failed" : s)),
      LOAD_MS,
    );
    return () => window.clearTimeout(timer);
  }, [attempt]);

  // Keys typed inside the live page stay with it, Esc too. Once the mouse
  // leaves the page, focus comes back to the pop-up so Esc closes again.
  useEffect(() => {
    const el = screen.current;
    if (!el) return;
    const back = () => {
      if (document.activeElement?.tagName === "IFRAME") dialog.current?.focus();
    };
    el.addEventListener("mouseleave", back);
    return () => el.removeEventListener("mouseleave", back);
  }, []);

  // Keys: Esc closes, Tab stays inside, and nothing reaches the deck.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const box = dialog.current;
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === "Tab" && box) {
        const els = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const first = els[0];
        const last = els[els.length - 1];
        const at = document.activeElement;
        if (first && last) {
          if (e.shiftKey && (at === first || !box.contains(at))) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && (at === last || !box.contains(at))) {
            e.preventDefault();
            first.focus();
          }
        }
      }
      // Caught on the way down, so the deck's own keys never see it.
      e.stopPropagation();
    };
    const onFocus = (e: FocusEvent) => {
      const box = dialog.current;
      if (box && !box.contains(e.target as Node)) closeBtn.current?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      before?.focus?.();
    };
  }, []);

  const root = document.querySelector(".dk-root") ?? document.body;
  const dir = ar(lang) ? "rtl" : "ltr";
  const shot = view === "phone" ? phone : desktop;

  return createPortal(
    <div
      className="dk-live"
      data-leaving={leaving ? "" : undefined}
      // A swipe in here is not a swipe of the deck.
      onTouchStart={e => e.stopPropagation()}
      onTouchEnd={e => e.stopPropagation()}
    >
      <button
        type="button"
        className="dk-live-backdrop"
        aria-hidden
        tabIndex={-1}
        onClick={close}
      />
      <div
        className="dk-live-canvas"
        dir={dir}
        lang={lang}
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        <div
          ref={dialog}
          className="dk-live-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t(COPY.title, lang)}
          tabIndex={-1}
        >
          <div className="dk-live-head">
            <div className="dk-live-words">
              <p className="dk-live-title">{t(COPY.title, lang)}</p>
              <p className="dk-live-state" data-status={status}>
                <i aria-hidden />
                <span role="status">{t(COPY[status], lang)}</span>
                {status === "failed" ? (
                  <button
                    type="button"
                    className="dk-live-retry"
                    onClick={() => setAttempt(a => a + 1)}
                  >
                    {t(COPY.retry, lang)}
                  </button>
                ) : null}
              </p>
            </div>
            <fieldset className="dk-live-views">
              <legend className="sr-only">{t(COPY.views, lang)}</legend>
              {(["desktop", "phone"] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                >
                  {t(COPY[v], lang)}
                </button>
              ))}
            </fieldset>
            <div className="dk-live-actions">
              <a
                className="dk-link"
                href={url}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t(COPY.newTab, lang)}
                <span aria-hidden className="dk-ltr">
                  ↗
                </span>
              </a>
              <button
                ref={closeBtn}
                type="button"
                className="dk-btn dk-quiet dk-live-close"
                onClick={close}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                </svg>
                {t(COPY.close, lang)}
              </button>
            </div>
          </div>
          <div className="dk-live-body">
            {/* One frame that turns from a browser into a phone, so the
                page re-flows to the phone layout without loading again. */}
            <div className="dk-live-frame" data-view={view}>
              <div className="dk-live-bar" aria-hidden>
                <i />
                <i />
                <i />
                <span>{host}</span>
              </div>
              <div ref={screen} className="dk-live-screen">
                <img src={shot.src} alt={shot.alt} />
                <iframe
                  key={attempt}
                  src={url}
                  title={t(COPY.title, "en")}
                  // Clicked into, not tabbed into: Tab keeps to the pop-up's own controls.
                  tabIndex={-1}
                  // Shown once it has fully loaded, crossfading over the
                  // screenshot, so a half-drawn page never shows.
                  data-on={status === "live" ? "" : undefined}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                  onLoad={() => setStatus("live")}
                />
                <i className="dk-phone-notch" aria-hidden />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    root,
  );
}
