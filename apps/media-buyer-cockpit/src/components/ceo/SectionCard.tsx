import { motion, useReducedMotion } from "framer-motion";
import { CircleDashed, Clock, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Note } from "../../../convex/ceo/payloads";
import { EmptyState } from "./EmptyState";
import { dateTime, relative } from "./format";
import { Hint } from "./Hint";
import { Notes } from "./Notes";
import { RefreshButton } from "./RefreshButton";
import {
  type AnyCeoSection,
  type CeoSection,
  type PayloadMap,
  type SectionKey,
  STALE_AFTER_MS,
  useNow,
} from "./useCeo";

type SectionCardProps<K extends SectionKey> = {
  /** Card title, sentence case. */
  title: ReactNode;
  /** Small uppercase label above the title. */
  kicker?: string;
  /** The section this card reads. null (not computed yet) shows the empty state; leave it out for a card with no section. */
  section?: CeoSection<K> | null;
  /** Other sections the card also reads: their failures join the banner and the oldest time wins "as of". */
  alsoReads?: (AnyCeoSection | null)[];
  /** Trust caveats listed at the foot of the card. */
  notes?: Note[] | null;
  /** Controls on the right of the header (toggles, links). */
  actions?: ReactNode;
  /** Body, or a function that receives the section payload once one exists. */
  children?: ReactNode | ((payload: PayloadMap[K]) => ReactNode);
  /** Stagger position for the first-load fade (0, 1, 2...). */
  order?: number;
  /** Hide the "as of" time, e.g. when a neighbouring card already shows it. */
  hideAsOf?: boolean;
  /** Anchor id for links into the card. */
  id?: string;
  className?: string;
  /** Classes for the body wrapper (spacing between children). */
  bodyClassName?: string;
};

/**
 * The card every CEO section sits in: title, "as of" time, a stale banner when
 * the last refresh failed, an empty state when the section is missing, and the
 * payload's notes. Pass a render function as children to get the typed payload.
 */
export function SectionCard<K extends SectionKey>({
  title,
  kicker,
  section,
  alsoReads,
  notes,
  actions,
  children,
  order = 0,
  hideAsOf = false,
  id,
  className,
  bodyClassName,
}: SectionCardProps<K>) {
  const reduce = useReducedMotion();
  const tracked = section !== undefined;
  const all = [
    ...(tracked ? [section] : []),
    ...(alsoReads ?? []),
  ] as (AnyCeoSection | null)[];
  const present = all.filter((s): s is AnyCeoSection => s !== null);
  const failed = present.filter(s => !s.ok);
  const asOf = present.length
    ? Math.min(...present.map(s => s.computedAt || Number.POSITIVE_INFINITY))
    : null;

  let body: ReactNode;
  if (tracked && section === null) {
    body = (
      <EmptyState
        icon={CircleDashed}
        title="Not computed yet"
        text="These numbers fill in after the next refresh, usually within 15 minutes."
        action={<RefreshButton size="sm" />}
        compact
      />
    );
  } else if (typeof children === "function") {
    const payload = section?.payload ?? null;
    body =
      payload === null ? (
        <EmptyState
          icon={CircleDashed}
          title="No numbers yet"
          text={
            section
              ? "The first refresh for this section has not succeeded."
              : undefined
          }
          action={section ? <RefreshButton size="sm" /> : undefined}
          compact
        />
      ) : (
        children(payload as PayloadMap[K])
      );
  } else {
    body = children;
  }

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
        "ceo-card min-w-0 rounded-xl border bg-card p-5 text-card-foreground",
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
          {/* h2: the page title is the h1, so card titles are the next level down. */}
          <h2 className="text-sm font-semibold leading-5 text-foreground">
            {title}
          </h2>
        </div>
        {(asOf !== null && Number.isFinite(asOf) && !hideAsOf) || actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {asOf !== null && Number.isFinite(asOf) && !hideAsOf ? (
              <AsOf at={asOf} />
            ) : null}
            {actions}
          </div>
        ) : null}
      </header>

      {failed.map(s => (
        <StaleBanner key={s.key} section={s} showLabel={present.length > 1} />
      ))}

      <div className={cn("mt-4 min-w-0", bodyClassName)}>{body}</div>

      {notes?.length ? (
        <Notes notes={notes} className="mt-4 border-t pt-3" />
      ) : null}
    </motion.section>
  );
}

/** Muted "as of 10:40"; a warning icon when it is older than 45 minutes. */
function AsOf({ at }: { at: number }) {
  const now = useNow();
  const old = now - at > STALE_AFTER_MS;
  return (
    <Hint content={`Computed ${relative(at, now)}`}>
      <button
        type="button"
        className="inline-flex cursor-default items-center gap-1 rounded-sm text-xs text-muted-foreground tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {old ? (
          <TriangleAlert
            className="size-3.5"
            style={{ color: "var(--ceo-warning)" }}
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

function StaleBanner({
  section,
  showLabel,
}: {
  section: AnyCeoSection;
  showLabel: boolean;
}) {
  const now = useNow();
  const lead = showLabel ? `${section.label}: could` : "Could";
  const since = section.lastOkAt
    ? `Showing numbers from ${dateTime(section.lastOkAt, now)}.`
    : "There are no good numbers to show yet.";
  return (
    <div
      role="status"
      className="ceo-stale mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-foreground"
    >
      <TriangleAlert
        className="mt-0.5 size-3.5 shrink-0"
        style={{ color: "var(--ceo-warning)" }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p>
          {lead} not refresh at {dateTime(section.computedAt, now)}. {since}
        </p>
        {section.error ? (
          <details className="group mt-1">
            <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
              Details
            </summary>
            <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
              {section.error}
            </p>
          </details>
        ) : null}
      </div>
    </div>
  );
}
