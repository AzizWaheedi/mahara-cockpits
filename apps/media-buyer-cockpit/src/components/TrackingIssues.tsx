import { useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "../../convex/_generated/api";

/**
 * Tracking faults on live ads, checked against Meta directly.
 *
 * Deliberately quiet: one line unless she opens it. It is a standing hygiene
 * problem, not something that needs to shout over the day's decisions.
 */
export function TrackingIssues() {
  const rows = useQuery(api.tracking.issues, {});
  const [open, setOpen] = useState(false);
  if (!rows || rows.length === 0) return null;

  const total = rows.reduce((n, r) => n + r.count, 0);

  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 className="text-[15px] font-semibold">Tracking backlog</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} ad{total === 1 ? "" : "s"} across {rows.length} client
            {rows.length === 1 ? "" : "s"} without UTM strings or a lead form.
            Backlog, not today's work: a ClickUp task on the ads board carries
            the list, refreshed weekly.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide" : "Show"}
        </Button>
      </div>

      {open && (
        <ul className="mt-4 divide-y">
          {rows.map(r => (
            <li key={r.client} className="py-2.5 first:pt-0 last:pb-0">
              <div className="text-sm font-medium">
                {r.client}{" "}
                <span className="font-normal tabular-nums text-muted-foreground">
                  · {r.count}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {[...new Set(r.ads.map(a => a.issue))].join(" · ")}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
