import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * "Is this thing working, and what is Viktor doing right now?"
 *
 * A cockpit that silently goes stale is worse than no cockpit: she acts on
 * yesterday's numbers believing they are today's. This strip states when the
 * data last refreshed, what is still queued for Viktor, and what the last sync
 * could not do — in plain words, at the top of the screen. [aziz, 2026-09-07]
 */

function ago(t: number) {
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function ViktorStatus() {
  const a = useQuery(api.chat.activity, { limit: 6 });
  const jobs = useQuery(api.assist.queueDepth, {});
  if (!a) return null;

  const stale = a.lastSyncAt
    ? Date.now() - a.lastSyncAt > 5 * 3600 * 1000
    : true;
  const problems: string[] = a.problems ?? [];

  return (
    <div
      className={`mb-3 rounded-lg border px-3 py-2 text-[12px] ${
        problems.length > 0 || stale
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "bg-muted/30"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          <span className="font-bold">Data</span>{" "}
          {a.lastSyncAt ? (
            <>
              refreshed {ago(a.lastSyncAt)}
              {a.lastSyncOk === false && " — with problems"}
            </>
          ) : (
            "has never synced"
          )}
        </span>
        <span>
          <span className="font-bold">Questions to Aziz</span>{" "}
          {a.queued === 0 ? "all delivered" : `${a.queued} still sending`}
        </span>
        {jobs && jobs.queued + jobs.working > 0 && (
          <span>
            <span className="font-bold">Jobs</span>{" "}
            {jobs.working > 0 ? `${jobs.working} running` : ""}
            {jobs.working > 0 && jobs.queued > 0 ? " · " : ""}
            {jobs.queued > 0 ? `${jobs.queued} queued` : ""}
          </span>
        )}
      </div>
      {problems.length > 0 && (
        <div className="mt-1">
          {problems.map(p => (
            <div key={p}>• {p}</div>
          ))}
        </div>
      )}
      {a.recent?.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[12px] text-muted-foreground">
            Latest activity
          </summary>
          <div className="mt-1 space-y-0.5">
            {/* biome-ignore lint/suspicious/noExplicitAny: chat rows */}
            {(a.recent as any[]).map(m => (
              <div key={m._id} className="text-[12px]">
                <span className="text-muted-foreground">
                  {new Date(m.at).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {m.campaignName} ·{" "}
                </span>
                {m.author === "viktor" ? "Answer: " : ""}
                {m.text.length > 90 ? `${m.text.slice(0, 90)}…` : m.text}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
