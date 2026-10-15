import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, useQuery } from "@/lib/cockpitApi";

/**
 * Tracking faults on live ads, checked against Meta directly.
 *
 * Deliberately quiet: one line unless she opens it. It is a standing hygiene
 * problem, not something that needs to shout over the day's decisions.
 *
 * The list comes from the daily tracking audit
 * (supabase/functions/tracking-audit). Its ClickUp task is written only once
 * ClickUp posting is on (it was a dry run on 13 October 2026), so the copy
 * points at Show, not at ClickUp. Each row is one gap on one ad, and an ad
 * can have two.
 */
export function TrackingIssues() {
  const rows = useQuery(api.tracking.issues, {});
  const [open, setOpen] = useState(false);
  if (!rows || rows.length === 0) return null;

  const total = rows.reduce((n: any, r: any) => n + r.count, 0);

  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 className="text-[15px] font-semibold">Tracking backlog</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} tracking gap{total === 1 ? "" : "s"} on live ads across{" "}
            {rows.length} client{rows.length === 1 ? "" : "s"}: no UTM string,
            or no lead form. A daily check against Meta finds them. Backlog, not
            today's work: Show lists them by client.
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
          {rows.map((r: any) => (
            <li key={r.client} className="py-2.5 first:pt-0 last:pb-0">
              <div className="text-sm font-medium">
                {r.client}{" "}
                <span className="font-normal tabular-nums text-muted-foreground">
                  · {r.count}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {[...new Set((r.ads ?? []).map((a: any) => a.issue))].join(
                  " · ",
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
