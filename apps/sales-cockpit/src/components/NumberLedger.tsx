import {
  CalendarCheck,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { type Currency, readNumber, sayMoney } from "../lib/funnel";
import { type Capture, LEDGER_FUNNEL, LEDGER_LABELS } from "../lib/script";
import { FilterChip, field } from "./kit";

/**
 * The number ledger (sales simplify, 2026-10-10): the prospect's numbers as
 * slots pinned above the script, so the rep never scrolls away from the line
 * they are on to see or type one. An empty slot is a dashed outline naming
 * what to ask; a typed one fills teal, in Geist Mono. On the demo the last
 * four are the funnel in its real order, joined by chevrons. On the intro the
 * strip ends in Book the demo, which turns into the booked time.
 */

/**
 * Where the strip sticks: under the phone's header (sticky, with the safe
 * area); on a laptop the menu bar scrolls away, so near the top.
 */
export const LEDGER_TOP =
  "top-[calc(3.6rem+env(safe-area-inset-top,0px))] lg:top-3";

/** How a typed value shows in its slot: "85k KWD", "14". */
export function slotValue(
  raw: string | undefined,
  c: Capture | undefined,
  currency: Currency,
): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const short = t.length > 14 ? `${t.slice(0, 13)}…` : t;
  return c?.type === "money" && !/[a-z]{3}$/i.test(t)
    ? `${short} ${currency}`
    : short;
}

export function NumberLedger({
  slots,
  captures,
  values,
  currency,
  onChange,
  onJump,
  book,
  answers,
  onAnswers,
  funnelOpen,
  onFunnel,
  fromIntro,
  head,
  className = "",
}: {
  slots: string[];
  captures: Capture[];
  values: Record<string, string>;
  currency: Currency;
  onChange: (key: string, value: string) => void;
  /** Scroll to the slot's own field when it is on screen; false when it is not. */
  onJump: (key: string) => boolean;
  /** The intro's last slot: the booked time, or null before it is booked. */
  book?: { booked: string | null; onClick: () => void } | null;
  answers: { filled: number; total: number };
  onAnswers: () => void;
  funnelOpen: boolean;
  onFunnel: () => void;
  fromIntro: (key: string) => boolean;
  /** A row above the slots (the phone's part stepper). */
  head?: ReactNode;
  className?: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const byKey = new Map(captures.map(c => [c.key, c]));
  const shown = slots.filter(k => byKey.has(k));
  const filled = shown.filter(k => (values[k] ?? "").trim()).length;
  const editCap = editing ? byKey.get(editing) : undefined;

  function press(key: string) {
    if (editing === key) {
      setEditing(null);
      return;
    }
    if (onJump(key)) {
      setEditing(null);
      return;
    }
    setEditing(key);
  }

  const funnelKeys = shown.filter(k => LEDGER_FUNNEL.includes(k));
  const slot = (k: string) => {
    const c = byKey.get(k);
    const v = slotValue(values[k], c, currency);
    return (
      <Slot
        key={k}
        label={LEDGER_LABELS[k] ?? c?.label ?? k}
        value={v}
        open={editing === k}
        fromIntro={Boolean(v) && fromIntro(k)}
        onClick={() => press(k)}
      />
    );
  };

  // The count and the two drawers: under the slots on a phone, at the end
  // of their row from a tablet up, where the slots wrap instead of scroll.
  const controls = (
    <>
      <span className="muted font-mono tabular-nums">
        {filled} of {shown.length}
      </span>
      <button
        type="button"
        onClick={onAnswers}
        className="muted underline-offset-2 hover:text-[color:var(--foreground)] hover:underline"
      >
        All answers{" "}
        <span className="font-mono tabular-nums">
          {answers.filled} of {answers.total}
        </span>
      </button>
      <button
        type="button"
        aria-expanded={funnelOpen}
        onClick={onFunnel}
        className="inline-flex items-center gap-1 font-medium hover:underline"
        style={{ color: "var(--primary)" }}
      >
        Their numbers
        <ChevronDown
          className={`size-3.5 transition-transform motion-reduce:transition-none ${funnelOpen ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
    </>
  );

  return (
    <div className={`sticky z-[6] ${LEDGER_TOP} ${className}`} data-ledger>
      <div className="rounded-[18px] border border-white/10 bg-[color:var(--card)]/95 shadow-lg shadow-black/20 backdrop-blur-md">
        {head ? (
          <div className="border-b border-white/5 px-2 py-1.5">{head}</div>
        ) : null}
        <div className="no-scrollbar flex items-stretch gap-1.5 overflow-x-auto px-2 py-2 sm:flex-wrap sm:overflow-visible">
          {shown.filter(k => !LEDGER_FUNNEL.includes(k)).map(k => slot(k))}
          {funnelKeys.length ? (
            // The funnel stays on one row, in its real order.
            <div className="flex shrink-0 items-center gap-1">
              {funnelKeys.map((k, i) => (
                <div key={k} className="flex shrink-0 items-center gap-1">
                  {i > 0 ? (
                    <ChevronRight
                      className="muted size-3.5 shrink-0 rtl:rotate-180"
                      aria-hidden
                    />
                  ) : null}
                  {slot(k)}
                </div>
              ))}
            </div>
          ) : null}
          {book ? (
            <button
              type="button"
              onClick={book.onClick}
              // First on a phone, where the strip scrolls sideways and the
              // end of it is off screen: the booking is never hidden.
              className={`order-first flex h-11 shrink-0 items-center gap-2 rounded-[12px] px-3 text-left text-xs transition-[background-color,border-color] duration-[180ms] motion-reduce:transition-none sm:order-none ${
                book.booked
                  ? "border border-transparent bg-[color:color-mix(in_oklch,var(--primary)_18%,transparent)] ring-1 ring-[color:color-mix(in_oklch,var(--primary)_50%,transparent)] ring-inset"
                  : "border border-dashed border-[color:color-mix(in_oklch,var(--primary)_55%,transparent)] hover:bg-white/[0.04]"
              }`}
            >
              {book.booked ? (
                <CalendarCheck
                  className="size-4 shrink-0"
                  style={{ color: "var(--primary)" }}
                  aria-hidden
                />
              ) : (
                <CalendarPlus
                  className="size-4 shrink-0"
                  style={{ color: "var(--primary)" }}
                  aria-hidden
                />
              )}
              <span className="flex flex-col leading-tight">
                <span className="muted text-[10px] font-medium">
                  {book.booked ? "Demo" : "Next step"}
                </span>
                <span
                  className={`whitespace-nowrap ${book.booked ? "font-mono text-[13px] font-medium" : "text-[13px] font-semibold"}`}
                >
                  {book.booked ?? "Book the demo"}
                </span>
              </span>
            </button>
          ) : null}
          <div className="hidden items-center gap-x-3 self-center px-1.5 text-xs sm:flex">
            {controls}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/5 px-3 py-1.5 text-xs sm:hidden">
          {controls}
        </div>
        {editCap ? (
          <div className="border-t border-white/5 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <CaptureField
                  c={editCap}
                  value={values[editCap.key] ?? ""}
                  onChange={v => onChange(editCap.key, v)}
                  currency={currency}
                  fromIntro={fromIntro(editCap.key)}
                  autoFocus
                  onEnter={() => setEditing(null)}
                />
              </div>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="muted -me-1 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] hover:bg-white/[0.06]"
                aria-label="Done"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Slot({
  label,
  value,
  open,
  fromIntro,
  onClick,
}: {
  label: string;
  value: string | null;
  open: boolean;
  fromIntro: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      title={
        value
          ? `${label}: ${value}${fromIntro ? " (from the intro)" : ""}`
          : `Ask for it: ${label}`
      }
      className={`flex h-11 min-w-[5.5rem] shrink-0 flex-col items-start justify-center rounded-[12px] px-2.5 text-left leading-tight transition-[background-color,border-color] duration-[180ms] motion-reduce:transition-none ${
        value
          ? "border border-transparent bg-[color:color-mix(in_oklch,var(--primary)_16%,transparent)] ring-1 ring-[color:color-mix(in_oklch,var(--primary)_45%,transparent)] ring-inset"
          : "border border-dashed border-[color:color-mix(in_oklch,var(--muted-foreground)_55%,transparent)] hover:bg-white/[0.04]"
      } ${open ? "outline outline-2 outline-offset-1 outline-[color:var(--ring)]" : ""}`}
    >
      <span
        className={`whitespace-nowrap text-[10px] font-medium ${value ? "muted" : ""}`}
        style={value ? undefined : { color: "var(--muted-foreground)" }}
      >
        {label}
      </span>
      {value ? (
        <span className="whitespace-nowrap font-mono text-[13px] font-medium tabular-nums">
          {value}
        </span>
      ) : (
        <span className="muted whitespace-nowrap text-[12px]">Ask</span>
      )}
    </button>
  );
}

/**
 * How a typed number was read, when it was not typed as a plain number
 * ("85k" reads as 85,000 KWD), and a plain warning when it cannot be read.
 */
export function Reads({
  raw,
  money,
  currency,
}: {
  raw: string | undefined;
  money: boolean;
  currency: Currency;
}) {
  const text = (raw ?? "").trim();
  if (!text || /^\d+(\.\d+)?$/.test(text)) return null;
  const n = readNumber(text);
  if (n == null)
    return (
      <p className="text-xs" style={{ color: "var(--warning)" }}>
        No number in this, so the math leaves it out.
      </p>
    );
  return (
    <p className="muted font-mono text-xs tabular-nums">
      Reads as{" "}
      {money
        ? sayMoney(n, currency, "en")
        : Number.isInteger(n)
          ? n.toLocaleString("en-US")
          : String(Math.round(n * 10) / 10)}
    </p>
  );
}

/**
 * One answer to capture: the label at the start, then the input (with the
 * currency for money, and how it reads under it), or chips for a choice. A
 * filled field carries a teal start border; logical sides, so Arabic mirrors.
 */
export function CaptureField({
  c,
  value,
  onChange,
  currency,
  fromIntro,
  inputId,
  autoFocus = false,
  onEnter,
  inline = false,
}: {
  c: Capture;
  value: string;
  onChange: (v: string) => void;
  currency: Currency;
  fromIntro: boolean;
  /** The id the ledger focuses (`cap-input-<key>`), for the one copy under its line. */
  inputId?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  /** Under its line in the script: the slim row. */
  inline?: boolean;
}) {
  const own = useId();
  const id = inputId ?? `${own}-input`;
  const labelId = `${id}-label`;
  const filled = value.trim() !== "";
  const numeric = c.type === "money" || c.type === "number";
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const label: ReactNode = (
    <span
      id={labelId}
      className="muted flex min-w-0 items-baseline gap-1.5 text-xs sm:w-44 sm:shrink-0"
    >
      <span className="min-w-0">{c.label}</span>
      {fromIntro ? (
        <span
          className="shrink-0 text-[11px]"
          style={{ color: "var(--primary)" }}
        >
          from the intro
        </span>
      ) : null}
    </span>
  );
  return (
    <div
      data-capture={c.key}
      data-inline={inline ? "" : undefined}
      className={`border-s-2 ps-3 transition-[border-color] duration-[180ms] motion-reduce:transition-none ${
        inline ? "ms-1 py-1" : "py-0.5"
      } ${filled ? "border-[color:var(--primary)]" : "border-white/10"}`}
    >
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        {c.type === "choice" ? (
          <>
            {label}
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-labelledby={labelId}
            >
              {(c.options ?? []).map(o => (
                <FilterChip
                  key={o}
                  on={value === o}
                  onClick={() => onChange(value === o ? "" : o)}
                >
                  {o}
                </FilterChip>
              ))}
            </div>
          </>
        ) : (
          <>
            <label htmlFor={id} className="contents">
              {label}
            </label>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <input
                ref={ref}
                id={id}
                value={value}
                onChange={e => onChange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && onEnter) onEnter();
                }}
                inputMode={c.type === "number" ? "decimal" : undefined}
                dir="auto"
                className={`${field} h-10 min-w-0 flex-1 sm:max-w-[20rem] ${numeric ? "font-mono tabular-nums" : ""}`}
              />
              {c.type === "money" ? (
                <span className="muted shrink-0 font-mono text-xs">
                  {currency}
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
      {numeric ? (
        <div className="sm:ps-[11.75rem]">
          <Reads raw={value} money={c.type === "money"} currency={currency} />
        </div>
      ) : null}
    </div>
  );
}
