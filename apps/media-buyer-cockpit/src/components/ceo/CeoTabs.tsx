import { motion, useReducedMotion } from "framer-motion";
import { type KeyboardEvent, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { cn } from "@/lib/utils";
import { count } from "./format";
import { STATUS_COLOR, type StatusTone } from "./StatusChip";

export type CeoTab<K extends string = string> = {
  /** Value in ?tab=. */
  key: K;
  /** Visible label, sentence case. */
  label: string;
  /** Small badge after the label; 0 or null hides it. */
  count?: number | null;
  /** Dot color on the badge, for counts that mean trouble. */
  countTone?: StatusTone;
};

/** Element ids that tie each tab to its panel. */
export const tabId = (key: string) => `ceo-tab-${key}`;
export const panelId = (key: string) => `ceo-panel-${key}`;

/**
 * The active tab, read from and written to ?tab= (other query params are kept).
 * An unknown or missing value falls back to `fallback`.
 */
export function useTabParam<K extends string>(
  keys: readonly K[],
  fallback: K,
  param = "tab",
): [K, (key: K) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(param);
  const active = (keys as readonly string[]).includes(raw ?? "")
    ? (raw as K)
    : fallback;
  const setActive = useCallback(
    (key: K) => {
      setParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (key === fallback) next.delete(param);
          else next.set(param, key);
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setParams, fallback, param],
  );
  return [active, setActive];
}

/** Underline tabs with arrow-key navigation and optional count badges. */
export function CeoTabs<K extends string>({
  tabs,
  value,
  onChange,
  ariaLabel = "CEO sections",
  className,
}: {
  /** Tabs in order. */
  tabs: CeoTab<K>[];
  /** Active key (from useTabParam). */
  value: K;
  /** Called with the new key (the setter from useTabParam). */
  onChange: (key: K) => void;
  /** Screen reader name for the tab list. */
  ariaLabel?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // On a phone the row scrolls: bring the active tab into view whenever it
  // changes (a link from another tab, a shared ?tab= URL). scrollLeft rather
  // than scrollIntoView, so the page itself never jumps vertically.
  useEffect(() => {
    const list = listRef.current;
    const el = refs.current.get(value);
    if (!list || !el || list.scrollWidth <= list.clientWidth) return;
    const l = list.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.left < l.left) list.scrollLeft -= l.left - r.left + 16;
    else if (r.right > l.right) list.scrollLeft += r.right - l.right + 16;
  }, [value]);

  const focusTab = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    if (!tab) return;
    onChange(tab.key);
    refs.current.get(tab.key)?.focus({ preventScroll: true });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex(t => t.key === value);
    if (e.key === "ArrowRight") focusTab(i + 1);
    else if (e.key === "ArrowLeft") focusTab(i - 1);
    else if (e.key === "Home") focusTab(0);
    else if (e.key === "End") focusTab(tabs.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={cn(
        "ceo-scroll-x -mb-px flex min-w-0 items-stretch gap-1 overflow-x-auto",
        className,
      )}
    >
      {tabs.map(tab => {
        const active = tab.key === value;
        const showCount = typeof tab.count === "number" && tab.count > 0;
        return (
          <button
            key={tab.key}
            ref={el => {
              if (el) refs.current.set(tab.key, el);
              else refs.current.delete(tab.key);
            }}
            type="button"
            role="tab"
            id={tabId(tab.key)}
            aria-selected={active}
            aria-controls={panelId(tab.key)}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.key)}
            className={cn(
              "relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-t-md px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              active
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {showCount ? (
              <span
                className={cn(
                  "inline-flex h-[18px] min-w-[18px] items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-medium leading-none tabular-nums",
                  active
                    ? "bg-foreground/10 text-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {tab.countTone && tab.countTone !== "neutral" ? (
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: STATUS_COLOR[tab.countTone] }}
                  />
                ) : null}
                {count(tab.count)}
              </span>
            ) : null}
            {active ? (
              <motion.span
                layoutId={reduce ? undefined : "ceo-tab-underline"}
                transition={{ type: "spring", stiffness: 520, damping: 42 }}
                className="absolute inset-x-3 bottom-0 h-0.5 rounded-full"
                style={{ backgroundColor: "var(--ceo-emphasis)" }}
                aria-hidden
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
