import { cn } from "@/lib/utils";
import { count, dateTime, plural, relative } from "./format";
import { Hint } from "./Hint";

/**
 * The page's one line of trust: when the numbers were computed, and whether
 * anything underneath them is stale or failing. One pill instead of three,
 * so the header stays a header (Aziz, 2026-09-26: "anything that looks too
 * busy"). The dot is green when everything is fresh and orange when
 * something needs a look; a tap on an orange pill opens the Machine tab,
 * where every source is listed.
 */
export function TrustPills({
  asOf,
  now,
  stale,
  missing = 0,
  hermes,
  onOpenMachine,
  className,
}: {
  /** Oldest section refresh, epoch ms (trustSummary().asOf). */
  asOf: number | null;
  /** Current time (useNow()). */
  now: number;
  /** Names of stale sections and feeds (trustSummary().stale). */
  stale: string[];
  /** Count of sections not computed yet. */
  missing?: number;
  /** Hermes queue; null leaves it out. */
  hermes: { queued: number; failed: number } | null;
  /** Makes the pill open the Machine tab when something needs a look. */
  onOpenMachine?: () => void;
  className?: string;
}) {
  const staleCount = stale.length;
  const issues: string[] = [];
  if (staleCount > 0) issues.push(`${plural(staleCount, "source")} stale`);
  else if (missing > 0) issues.push(`${plural(missing, "section")} pending`);
  if (hermes && hermes.failed > 0)
    issues.push(`Hermes ${count(hermes.failed)} failed`);
  const trouble = issues.length > 0;

  const detail = (
    <div className="max-w-72 space-y-1">
      <p>
        {asOf
          ? `Oldest section computed ${relative(asOf, now)}.`
          : "No section has been computed yet."}
      </p>
      {staleCount > 0 ? (
        <p>
          Stale: {stale.slice(0, 8).join(", ")}
          {staleCount > 8 ? ` and ${count(staleCount - 8)} more` : ""}.
        </p>
      ) : null}
      {hermes ? (
        <p>
          Hermes: {count(hermes.queued)} queued
          {hermes.failed > 0 ? `, ${count(hermes.failed)} failed` : ""}.
        </p>
      ) : null}
      {trouble && onOpenMachine ? <p>Open Machine for the detail.</p> : null}
    </div>
  );

  // On a touch screen a tap on a calm pill opens its detail; a pill with
  // trouble goes straight to the Machine tab, which lists every source.
  return (
    <Hint content={detail} side="bottom" tap={!trouble}>
      <button
        type="button"
        onClick={trouble ? onOpenMachine : undefined}
        aria-label={[
          asOf ? `Updated ${dateTime(asOf, now)}` : "No data yet",
          ...issues,
        ].join(", ")}
        className={cn(
          "inline-flex h-8 min-w-0 shrink items-center gap-2 whitespace-nowrap rounded-full border bg-card px-3 text-xs font-medium text-foreground tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          trouble
            ? "transition-colors hover:bg-[var(--ceo-hover)]"
            : "cursor-default",
          className,
        )}
      >
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{
            backgroundColor: trouble ? "var(--ceo-warning)" : "var(--ceo-good)",
          }}
        />
        <span className="min-w-0 truncate">
          {asOf ? `Updated ${dateTime(asOf, now)}` : "No data yet"}
        </span>
        {trouble ? (
          <span className="hidden truncate text-muted-foreground md:inline">
            {issues.join(", ")}
          </span>
        ) : null}
      </button>
    </Hint>
  );
}
