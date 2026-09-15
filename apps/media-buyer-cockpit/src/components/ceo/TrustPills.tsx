import { Bot, CircleCheck, Clock, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { count, dateTime, plural, relative } from "./format";
import { Hint } from "./Hint";

function Pill({
  icon,
  children,
  hint,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  onClick?: () => void;
}) {
  const cls =
    "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-card px-2.5 text-xs font-medium text-foreground tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const pill = onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(cls, "transition-colors hover:bg-[var(--ceo-hover)]")}
    >
      {icon}
      {children}
    </button>
  ) : (
    <button type="button" className={cn(cls, "cursor-default")}>
      {icon}
      {children}
    </button>
  );
  return hint ? (
    <Hint content={hint} side="bottom">
      {pill}
    </Hint>
  ) : (
    pill
  );
}

/** Header trust signals: how old the numbers are, what is stale, and the Hermes queue. */
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
  /** Hermes queue; null hides the pill. */
  hermes: { queued: number; failed: number } | null;
  /** Makes the stale and Hermes pills open the Machine tab. */
  onOpenMachine?: () => void;
  className?: string;
}) {
  const staleCount = stale.length;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Pill
        icon={<Clock className="size-3.5 text-muted-foreground" aria-hidden />}
        hint={
          asOf ? `Oldest section computed ${relative(asOf, now)}` : undefined
        }
      >
        {asOf ? `as of ${dateTime(asOf, now)}` : "No data yet"}
      </Pill>

      {staleCount > 0 ? (
        <Pill
          icon={
            <TriangleAlert
              className="size-3.5"
              style={{ color: "var(--ceo-warning)" }}
              aria-hidden
            />
          }
          hint={
            <span>
              Stale: {stale.slice(0, 8).join(", ")}
              {staleCount > 8 ? ` and ${count(staleCount - 8)} more` : ""}
            </span>
          }
          onClick={onOpenMachine}
        >
          {plural(staleCount, "source")} stale
        </Pill>
      ) : missing > 0 ? (
        <Pill
          icon={
            <TriangleAlert
              className="size-3.5 text-muted-foreground"
              aria-hidden
            />
          }
          hint="Some sections fill in after the next refresh"
        >
          {plural(missing, "section")} pending
        </Pill>
      ) : (
        <Pill
          icon={
            <CircleCheck
              className="size-3.5"
              style={{ color: "var(--ceo-good)" }}
              aria-hidden
            />
          }
        >
          Sources fresh
        </Pill>
      )}

      {hermes ? (
        <Pill
          icon={
            <Bot
              className="size-3.5"
              style={{
                color:
                  hermes.failed > 0
                    ? "var(--ceo-warning)"
                    : "var(--muted-foreground)",
              }}
              aria-hidden
            />
          }
          hint={
            hermes.failed > 0
              ? `${plural(hermes.failed, "Hermes task")} failed`
              : "Tasks waiting for Hermes"
          }
          onClick={onOpenMachine}
        >
          Hermes {count(hermes.queued)} queued
          {hermes.failed > 0 ? `, ${count(hermes.failed)} failed` : ""}
        </Pill>
      ) : null}
    </div>
  );
}
