import { motion, useReducedMotion } from "framer-motion";
import { CircleDashed, Clock, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "./EmptyState";
import { dateTime, day, relative } from "./format";
import { Hint } from "./Hint";
import { type Note, Notes } from "./Notes";
import { useNow } from "./useNow";

/** A sync result older than this is treated as needing attention. */
export const STALE_AFTER_MS = 45 * 60_000;

export type SectionStale = {
  /** What could not refresh, named the way the person knows it. */
  label?: string;
  /** When the last attempt ran, successful or not. */
  at: number;
  /** When it last worked, so the banner can say what is on screen. */
  lastOkAt?: number | null;
  /** What the system said, shown behind a Details disclosure. */
  error?: string | null;
};

/**
 * The card every section of this app sits in, the same way every CEO section
 * sits in one: title, "as of" time, a stale banner when the last refresh
 * failed, an empty state when there is nothing to show yet, and the caveats at
 * the foot. A section that has nothing says what fills it rather than showing
 * a row of zeroes.
 */
export function SectionCard({
  title,
  kicker,
  asOf,
  stale,
  actions,
  notes,
  children,
  order = 0,
  hideAsOf = false,
  id,
  className,
  bodyClassName,
  /** Shown instead of the body, when there is nothing to show. */
  empty,
}: {
  /** Card title, sentence case. */
  title: ReactNode;
  /** Small uppercase label above the title. */
  kicker?: string;
  /** When this card's data was last computed, epoch ms. */
  asOf?: number | null;
  /** Set when the last refresh of what this card reads failed. */
  stale?: SectionStale | null;
  /** Controls on the right of the header. */
  actions?: ReactNode;
  /** Trust caveats listed at the foot of the card. */
  notes?: (Note | null | undefined)[] | null;
  children?: ReactNode;
  /** Stagger position for the first-load fade. */
  order?: number;
  /** Hide the "as of" time, e.g. when a neighbouring card already shows it. */
  hideAsOf?: boolean;
  id?: string;
  className?: string;
  bodyClassName?: string;
  empty?: {
    title: string;
    text?: ReactNode;
    action?: ReactNode;
  } | null;
}) {
  const reduce = useReducedMotion();
  const showAsOf = !hideAsOf && typeof asOf === "number" && asOf > 0;

  const body = empty ? (
    <EmptyState
      icon={CircleDashed}
      title={empty.title}
      text={empty.text}
      action={empty.action}
      compact
    />
  ) : (
    children
  );

  return (
    <motion.section
      id={id}
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.22,
        ease: "easeOut",
        delay: reduce ? 0 : Math.min(order, 8) * 0.04,
      }}
      className={cn(
        "mc-card min-w-0 rounded-xl border bg-card p-5 text-card-foreground",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {kicker ? (
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {kicker}
            </p>
          ) : null}
          {/* h2: the view title is the h1, so card titles are the next level down. */}
          <h2 className="text-sm font-semibold leading-5 text-foreground">
            {title}
          </h2>
        </div>
        {(showAsOf || actions) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {showAsOf ? <AsOf at={asOf} /> : null}
            {actions}
          </div>
        )}
      </header>

      {stale ? <StaleBanner stale={stale} /> : null}

      <div className={cn("mt-4 min-w-0", bodyClassName)}>{body}</div>

      <Notes notes={notes} className="mt-4 border-t pt-3" />
    </motion.section>
  );
}

/** Muted "as of today 14:40"; a warning icon when it is older than 45 minutes. */
export function AsOf({ at }: { at: number }) {
  const now = useNow();
  const old = now - at > STALE_AFTER_MS;
  return (
    <Hint content={`Computed ${relative(at, now)} — ${day(at)}`}>
      <button
        type="button"
        className="inline-flex cursor-default items-center gap-1 rounded-sm text-xs text-muted-foreground tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {old ? (
          <TriangleAlert
            className="size-3.5"
            style={{ color: "var(--mc-warning)" }}
            aria-label="Older than 45 minutes"
          />
        ) : (
          <Clock className="size-3.5" aria-hidden />
        )}
        as of {dateTime(at, now)}
      </button>
    </Hint>
  );
}

function StaleBanner({ stale }: { stale: SectionStale }) {
  const now = useNow();
  const lead = stale.label ? `${stale.label} could` : "That could";
  const since = stale.lastOkAt
    ? `Showing what came back at ${dateTime(stale.lastOkAt, now)}.`
    : "There is nothing good to show from it yet.";
  return (
    <div
      role="status"
      className="mc-stale mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-foreground"
    >
      <TriangleAlert
        className="mt-0.5 size-3.5 shrink-0"
        style={{ color: "var(--mc-warning)" }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p>
          {lead} not refresh at {dateTime(stale.at, now)}. {since}
        </p>
        {stale.error ? (
          <details className="group mt-1">
            <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
              Details
            </summary>
            <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
              {stale.error}
            </p>
          </details>
        ) : null}
      </div>
    </div>
  );
}
