import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import "./tasks.css";

/**
 * The panel the task list, the bell, the focus view and the request screens
 * open in: centred from 640px, a full-height sheet on a phone. No Radix (two
 * cockpits have none): it closes on Escape and on a click outside, keeps Tab
 * inside, hands focus back to what opened it, and locks the page behind it.
 * When one panel opens over another, only the top one answers Escape.
 * Built the way video-editor-cockpit's ui/dialog.tsx is.
 */

const open: symbol[] = [];
let pageOverflow: string | null = null;

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

export function TaskPanel(props: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  /** Wider from 640px, for an editor with two columns. */
  wide?: boolean;
  children: ReactNode;
}) {
  if (!props.open || typeof document === "undefined") return null;
  return createPortal(<Panel {...props} />, document.body);
}

function Panel({
  onClose,
  title,
  subtitle,
  footer,
  wide,
  children,
}: {
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const me = Symbol("panel");
    const cameFrom = document.activeElement as HTMLElement | null;
    open.push(me);
    if (open.length === 1) {
      pageOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    box.current?.focus();
    const top = () => open[open.length - 1] === me;
    const onKey = (e: KeyboardEvent) => {
      if (!top()) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !box.current) return;
      const all = [
        ...box.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter(el => !el.closest("[inert]"));
      if (!all.length) {
        e.preventDefault();
        return;
      }
      const first = all[0];
      const last = all[all.length - 1];
      const here = document.activeElement;
      if (e.shiftKey && (here === first || here === box.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && here === last) {
        e.preventDefault();
        first.focus();
      } else if (!box.current.contains(here)) {
        e.preventDefault();
        first.focus();
      }
    };
    // Capture, so the page's own single-key shortcuts do not fire behind it.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      const at = open.indexOf(me);
      if (at >= 0) open.splice(at, 1);
      if (open.length === 0) {
        document.body.style.overflow = pageOverflow ?? "";
        pageOverflow = null;
      }
      if (cameFrom?.isConnected) cameFrom.focus();
    };
  }, []);

  return (
    <div className="tk-layer">
      <button
        type="button"
        className="tk-backdrop"
        aria-label="Close"
        tabIndex={-1}
        onClick={() => close.current()}
      />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`tk-panel${wide ? " tk-panel-wide" : ""}`}
      >
        <header className="tk-panel-head">
          <div className="tk-panel-heading">
            <h2 id={titleId} className="tk-panel-title">
              {title}
            </h2>
            {subtitle ? <div className="tk-panel-sub">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            className="tk-icon-btn"
            aria-label="Close"
            onClick={() => close.current()}
          >
            <X aria-hidden size={18} />
          </button>
        </header>
        <div className="tk-panel-body">{children}</div>
        {footer ? <footer className="tk-panel-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}
