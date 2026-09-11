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
    <section className="mb-4 rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
            Tracking backlog
          </div>
          <p className="text-[13px] text-muted-foreground">
            {total} ad{total === 1 ? "" : "s"} across {rows.length} client
            {rows.length === 1 ? "" : "s"} without UTM strings or a lead form.
            Backlog, not today's work: a ClickUp task on the ads board carries
            the list, refreshed weekly.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[12px]"
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide" : "Show"}
        </Button>
      </div>

      {open && (
        <div className="mt-2.5 space-y-1.5">
          {rows.map(r => (
            <div key={r.client} className="rounded border bg-background p-2">
              <div className="text-[13px] font-semibold">
                {r.client}{" "}
                <span className="font-normal text-muted-foreground">
                  · {r.count}
                </span>
              </div>
              <div className="mt-0.5 text-[12px] text-muted-foreground">
                {[...new Set(r.ads.map(a => a.issue))].join(" · ")}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
