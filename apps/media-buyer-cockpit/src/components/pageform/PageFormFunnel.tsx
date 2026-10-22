import { useState } from "react";
import { count, dateTime, pct, shortDate } from "@/components/ceo/format";
import { STATUS_COLOR, StatusChip } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type FunnelStep, usePageFormFunnel } from "@/lib/pageFormClient";
import { cn } from "@/lib/utils";

const RANGES = [7, 30, 90] as const;

/** Visits lost at a step: the step before it, minus this one. */
const lost = (steps: FunnelStep[], i: number) =>
  i === 0 ? 0 : Math.max(0, steps[i - 1].visits - steps[i].visits);

/**
 * Where visitors stop on the page, screen by screen, for one version.
 * Muhammed, 2026-10-22: see where leads fall while they fill the form.
 * Counts come from the page's own events (page-form-events), once per visit.
 */
export function PageFormFunnel({
  slug,
  liveLabel,
  tick,
}: {
  slug: string;
  liveLabel: string;
  /** Changes after a publish or switch, so the counts follow the live version. */
  tick: number;
}) {
  const [days, setDays] = useState<number>(30);
  const [version, setVersion] = useState<string | undefined>(undefined);
  const funnel = usePageFormFunnel(slug, version, days, tick);
  const f = funnel.data;
  const steps = f?.steps ?? [];
  const opened = steps[0]?.visits ?? 0;
  // The screen that loses the most visits is the one to look at. The last
  // step (send to thank-you) is GHL saving the lead, not the visitor leaving.
  const worst = steps
    .map((s, i) => ({ i, n: lost(steps, i), s: s.screen }))
    .filter(x => x.i > 0 && x.s !== "thanks" && x.n > 0)
    .sort((a, b) => b.n - a.n)[0]?.i;
  const versions = [
    ...new Set([liveLabel, ...(f?.versions ?? []).map(v => v.version)]),
  ].sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  const shown = f?.version ?? version ?? liveLabel;

  return (
    <div className="mt-4 rounded-xl border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Where visitors stop</p>
        <div className="flex flex-wrap items-center gap-2">
          {versions.length > 1 && (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={shown}
              onValueChange={v => v && setVersion(v)}
              aria-label="Version"
            >
              {versions.map(v => (
                <ToggleGroupItem key={v} value={v} className="px-2.5">
                  {v}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(days)}
            onValueChange={v => v && setDays(Number(v))}
            aria-label="Range"
          >
            {RANGES.map(r => (
              <ToggleGroupItem key={r} value={String(r)} className="px-2.5">
                {r}d
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      {funnel.error ? (
        <div className="callout-warn mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs">
          <span>The drop-off counts could not be read: {funnel.error}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={funnel.reload}
          >
            Try again
          </Button>
        </div>
      ) : !f ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Reading the visits…
        </p>
      ) : opened === 0 && !f.lastAt ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No visits recorded for {shown} in the last {days} days. Counts start
          with the first real visit to the page; test visits never count.
        </p>
      ) : (
        <ol
          className={cn("mt-3 space-y-2", funnel.loading && "opacity-60")}
          aria-label={`Visits per screen, ${shown}, last ${days} days`}
        >
          {steps.map((s, i) => {
            const share = opened ? s.visits / opened : 0;
            const drop = lost(steps, i);
            const question = s.screen.startsWith("q:");
            return (
              <li key={s.screen} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="truncate"
                      dir={question ? "rtl" : undefined}
                    >
                      {s.label}
                    </span>
                    {i === worst && (
                      <StatusChip tone="warning" label="Biggest drop" />
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {count(s.visits)}
                    <span className="ml-2 inline-block w-12 text-right text-xs text-muted-foreground">
                      {i === 0 ? "" : pct(share)}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/80"
                      style={{
                        width: `${Math.round(share * 100)}%`,
                        ...(i === worst
                          ? { background: STATUS_COLOR.warning }
                          : {}),
                      }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                    {i > 0 && drop > 0 ? `${count(drop)} left here` : ""}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {f && !funnel.error && (
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Each visit counts once per screen, on{" "}
          {f.hosts.length ? f.hosts.join(", ") : "no host yet"}, since{" "}
          {shortDate(f.since)}. Test visits and the editor preview are not
          counted.{" "}
          {f.lastAt
            ? `Last visit recorded ${dateTime(Date.parse(f.lastAt))}.`
            : "No visit recorded yet."}{" "}
          Leads in the CRM are the count of record; "Saw the thank-you page"
          should match them.
        </p>
      )}
    </div>
  );
}
